/*
 * 对局流程模块。
 *
 * 规则固定为自由五子棋：人类黑子先手，AI 白子后手，没有禁手。
 * AI 每步最多 5 秒，搜索结果会写入右侧统计表。
 */

import { BLACK, BoardUI, EMPTY, SIZE, WHITE } from "./board-ui.js";
import { GomokuAIManager } from "./ai-manager.js";

const THINK_TIME_MS = 5000;

export class GomokuGame {
    /*
     * 创建一局游戏的控制器。
     *
     * `board` 是 15x15 的一维 Int8Array：黑棋 1、白棋 -1、空位 0。
     * `generation` 是异步安全令牌：每次重开都会递增，旧 Worker 结果回来时
     * 如果 generation 不一致，就说明它属于上一局，必须丢弃，不能再改 UI。
     */
    constructor(canvas) {
        this.ui = new BoardUI(canvas);
        this.ai = new GomokuAIManager({ thinkTimeMs: THINK_TIME_MS });
        this.board = new Int8Array(SIZE * SIZE);
        this.mode = null;
        this.turn = BLACK;
        this.over = false;
        this.thinking = false;
        this.generation = 0;
        this.moveIndex = 0;
    }

    async init() {
        /*
         * 初始化顺序必须先等待 AI Worker 池 ready，再绑定 UI。
         * 这样用户点击模式后不会遇到 Worker 还没加载 Wasm 的竞态。
         */
        await this.ai.ready();
        this.bindBoard();
        this.bindRestart();
        this.bindModeMenu();
        this.resetToMenu();
    }

    resetToMenu() {
        /*
         * 回到模式选择界面。
         *
         * 这个方法不是“再来一局”；它会清空当前模式并显示覆盖菜单。
         * 对局结束后的“再来一局”走 reset/startMode，保留当前模式重新开始。
         */
        this.mode = null;
        this.board = new Int8Array(SIZE * SIZE);
        this.turn = BLACK;
        this.over = false;
        this.thinking = false;
        this.generation++;
        this.moveIndex = 0;
        this.ui.clear();
        this.updateCounts();
        this.resetStats();
        this.showModeMenu();
        this.hideRestart();
        this.setStatus("请选择模式。");
    }

    reset() {
        /*
         * 终局后按钮调用这里。
         *
         * 如果已经选过模式，就沿用当前模式开新局；如果还没选模式，
         * 就回到菜单等待用户选择。
         */
        if (!this.mode) {
            this.resetToMenu();
            return;
        }
        this.startMode(this.mode);
    }

    startMode(mode) {
        /*
         * 开始指定模式。
         *
         * pve：人类黑子先手，AI 白子后手。
         * pvp：本机双人，黑白都由人类点击。
         * eve：AI 自博弈，黑白都通过同一个 Rust/Wasm 搜索器决策。
         */
        this.mode = mode;
        this.board = new Int8Array(SIZE * SIZE);
        this.turn = BLACK;
        this.over = false;
        this.thinking = false;
        this.generation++;
        this.moveIndex = 0;
        this.ui.clear();
        this.updateCounts();
        this.resetStats();
        this.hideModeMenu();
        this.hideRestart();
        this.setStatus(modeText(mode));
        if (this.isAiTurn()) {
            window.setTimeout(() => this.aiMove(), 180);
        }
    }

    bindBoard() {
        /*
         * 绑定棋盘点击。
         *
         * 五子棋 freestyle 下所有空点都合法，因此这里只检查：
         * - 对局是否已经开始或结束；
         * - 是否正在等待 AI；
         * - 当前回合是否属于人类；
         * - 目标点是否为空。
         */
        this.ui.canvas.addEventListener("click", async (event) => {
            if (this.over || this.thinking || !this.mode || this.isAiTurn()) return;
            const point = this.ui.pointFromEvent(event);
            if (!point) return;
            const idx = point.r * SIZE + point.c;
            if (this.board[idx] !== EMPTY) return;

            this.place(point, this.turn);
            this.recordMove({ side: this.turn, point, source: "人类" });
            if (this.finishIfWon(point, this.turn)) return;
            this.turn = -this.turn;
            if (this.isAiTurn()) await this.aiMove();
            else this.setStatus(this.turn === BLACK ? "轮到黑棋。" : "轮到白棋。");
        });
    }

    bindRestart() {
        /*
         * “再来一局”只在终局后显示。
         * 点击后不会遮挡棋盘，也不会清掉复盘，直到真正 reset 才重置。
         */
        document.getElementById("restart-btn").addEventListener("click", () => this.reset());
    }

    bindModeMenu() {
        /*
         * 模式按钮放在棋盘覆盖层上，风格和旧 Othello 项目一致。
         * 选择模式后隐藏覆盖层，棋盘本体不需要重新创建。
         */
        document.querySelectorAll(".mode-btn").forEach((button) => {
            button.addEventListener("click", () => this.startMode(button.dataset.mode));
        });
    }

    async aiMove() {
        /*
         * 执行一个 AI 回合。
         *
         * AI 搜索在 Web Worker 里运行，不会阻塞主线程。这里的关键是：
         * 1. `thinking` 防止用户或机机循环重复触发搜索；
         * 2. `generation` 防止旧对局的搜索结果回来后覆盖新棋局；
         * 3. `side` 在 await 前固定下来，避免等待期间 turn 被其他流程改动。
         */
        if (this.over || this.thinking || !this.isAiTurn()) return;
        const generation = this.generation;
        const side = this.turn;
        this.thinking = true;
        this.setStatus(`AI 正在计算${side === BLACK ? "黑" : "白"}棋落子...`);
        let result;
        try {
            result = await this.ai.search({ board: this.board, isBlackTurn: side === BLACK });
        } catch (error) {
            if (generation === this.generation) {
                this.setStatus(`AI 引擎出错：${error.message || error}`);
            }
            this.thinking = false;
            return;
        }
        if (this.over || generation !== this.generation) {
            // 旧搜索结果属于上一局，直接丢弃，不能落子或写评分表。
            this.thinking = false;
            return;
        }
        this.ui.setHeatmap(result.heatmap || []);

        if (result.r < 0 || result.c < 0) {
            this.over = true;
            this.thinking = false;
            this.endGame("棋盘已满，平局。");
            return;
        }

        const point = { r: result.r, c: result.c };
        this.place(point, side);
        this.recordMove({ side, point, source: "AI", stats: result });
        this.thinking = false;
        if (this.finishIfWon(point, side)) return;
        this.turn = -this.turn;
        if (this.isAiTurn()) {
            window.setTimeout(() => this.aiMove(), 120);
        } else {
            this.setStatus(this.mode === "pve" ? "轮到你落黑子。" : (this.turn === BLACK ? "轮到黑棋。" : "轮到白棋。"));
        }
    }

    place(point, side) {
        /*
         * 执行落子并刷新视觉状态。
         *
         * 这里不判断胜负，胜负统一交给 finishIfWon，避免落子和终局逻辑混在一起。
         */
        this.board[point.r * SIZE + point.c] = side;
        this.ui.setBoard(this.board);
        this.ui.setLastMove(point);
        this.updateCounts();
    }

    finishIfWon(point, side) {
        /*
         * 检查刚落下的这一步是否结束对局。
         *
         * JS 侧保留轻量胜负判断用于即时 UI 响应；Rust 侧也有 Bitboard 胜负判断，
         * 用于搜索过程。两边规则一致：任意方向五连即胜，没有禁手。
         */
        if (hasFive(this.board, point, side)) {
            this.over = true;
            this.ui.setHeatmap([]);
            this.endGame(winnerText(side));
            return true;
        }
        if (isFull(this.board)) {
            this.over = true;
            this.ui.setHeatmap([]);
            this.endGame("棋盘已满，平局。");
            return true;
        }
        return false;
    }

    updateCounts() {
        // 顶部圆形数字只显示棋子数量，不再显示“黑/白”文字。
        let black = 0;
        let white = 0;
        for (const cell of this.board) {
            if (cell === BLACK) black++;
            if (cell === WHITE) white++;
        }
        document.getElementById("black-count").textContent = String(black).padStart(2, "0");
        document.getElementById("white-count").textContent = String(white).padStart(2, "0");
    }

    resetStats() {
        /*
         * 清空右侧搜索表。
         *
         * 人类落子也会记录一行，但深度、节点、NPS、耗时、分数为空；
         * AI 落子行展示 Rust/Wasm 返回的真实搜索统计。
         */
        document.getElementById("ai-stats-body").innerHTML = `
            <tr id="ai-stats-empty">
                <td colspan="9">开始对局后显示搜索记录</td>
            </tr>
        `;
        document.getElementById("ai-current").textContent = this.mode ? modeText(this.mode) : "等待选择模式。";
    }

    recordMove({ side, point, source, stats = null }) {
        /*
         * 记录一步落子到右侧评分表。
         *
         * 注意：这里显示的分数是搜索视角下的 Minimax 评分，不是棋子数量。
         * 人类落子没有搜索统计，所以对应列显示 “-”。
         */
        this.moveIndex++;
        document.getElementById("ai-stats-empty")?.remove();

        const sideText = side === BLACK ? "黑" : "白";
        const sourceClass = source === "AI" ? "source-ai" : "source-human";
        const score = stats ? formatScore(stats.score) : "-";
        const scoreClass = stats ? scoreClassName(stats.score) : "score-neutral";
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>#${this.moveIndex}</td>
            <td>${sideText}</td>
            <td class="${sourceClass}">${source}</td>
            <td>${point.r},${point.c}</td>
            <td>${stats ? stats.depth : "-"}</td>
            <td>${stats ? formatCount(stats.nodes) : "-"}</td>
            <td>${stats ? formatCount(stats.nps) : "-"}</td>
            <td>${stats ? Math.round(stats.timeMs) + "ms" : "-"}</td>
            <td class="${scoreClass}">${score}</td>
        `;
        document.getElementById("ai-stats-body").appendChild(row);

        const current = source === "AI"
            ? `#${this.moveIndex} 白棋 AI 落子 ${point.r},${point.c}，深度 ${stats.depth}，评分 ${score}。`
            : `#${this.moveIndex} 黑棋 人类落子 ${point.r},${point.c}。`;
        document.getElementById("ai-current").textContent = current;

        const wrap = document.getElementById("ai-table-wrap");
        wrap.scrollTop = wrap.scrollHeight;
    }

    setStatus(text) {
        // 底部状态栏只负责文字，不负责显示/隐藏按钮。
        document.getElementById("status").textContent = text;
    }

    isAiTurn() {
        /*
         * 判断当前回合是否由 AI 控制。
         *
         * pve 固定“人类黑、AI 白”；eve 黑白都由 AI；pvp 永远不是 AI 回合。
         */
        if (this.mode === "eve") return true;
        if (this.mode === "pve") return this.turn === WHITE;
        return false;
    }

    showModeMenu() {
        // 显示覆盖在棋盘上的模式选择层。
        document.getElementById("mode-menu").classList.remove("hidden");
    }

    hideModeMenu() {
        // 隐藏模式选择层，露出可交互棋盘。
        document.getElementById("mode-menu").classList.add("hidden");
    }

    endGame(text) {
        /*
         * 展示终局信息。
         *
         * “再来一局”按钮只在这里出现，避免对局中占位置，也不遮挡棋盘，
         * 用户可以保留最终棋局复盘。
         */
        this.setStatus(`${text} 你可以保留棋盘复盘，或再来一局。`);
        document.getElementById("restart-btn").classList.remove("hidden");
    }

    hideRestart() {
        // 新局开始和回到菜单时都要隐藏终局按钮。
        document.getElementById("restart-btn").classList.add("hidden");
    }
}

function modeText(mode) {
    // 统一生成模式提示文案，避免多个入口写出不一致的规则说明。
    if (mode === "pvp") return "人人模式：黑棋先手。";
    if (mode === "eve") return "机机模式：AI 黑棋先手。";
    return "人机模式：人类黑子先手，AI 白子后手。";
}

function winnerText(side) {
    // 五子棋按最后形成五连的一方判胜。
    return side === BLACK ? "黑棋五连，黑棋获胜。" : "白棋五连，白棋获胜。";
}

function hasFive(board, point, side) {
    /*
     * JS 侧五连判断。
     *
     * 只从刚落子点向四个方向扩展，复杂度固定很低。
     * Rust 搜索内部使用 Bitboard shift-and，这里保留坐标版是为了 UI 简单可靠。
     */
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    return dirs.some(([dr, dc]) => {
        return 1 + countDir(board, point, side, dr, dc) + countDir(board, point, side, -dr, -dc) >= 5;
    });
}

function countDir(board, point, side, dr, dc) {
    // 沿一个方向累计同色连续棋子数，遇到边界或异色/空位立即停止。
    let total = 0;
    let r = point.r + dr;
    let c = point.c + dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r * SIZE + c] === side) {
        total++;
        r += dr;
        c += dc;
    }
    return total;
}

function isFull(board) {
    // 所有点都被占用且无人五连时判平局。
    return board.every(cell => cell !== EMPTY);
}

function formatCount(value) {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return `${value}`;
}

function formatScore(value) {
    return value > 0 ? `+${value}` : `${value}`;
}

function scoreClassName(value) {
    if (value > 0) return "score-positive";
    if (value < 0) return "score-negative";
    return "score-neutral";
}
