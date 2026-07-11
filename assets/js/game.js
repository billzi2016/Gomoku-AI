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
        await this.ai.ready();
        this.bindBoard();
        this.bindRestart();
        this.bindModeMenu();
        this.resetToMenu();
    }

    resetToMenu() {
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
        if (!this.mode) {
            this.resetToMenu();
            return;
        }
        this.startMode(this.mode);
    }

    startMode(mode) {
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
        document.getElementById("restart-btn").addEventListener("click", () => this.reset());
    }

    bindModeMenu() {
        document.querySelectorAll(".mode-btn").forEach((button) => {
            button.addEventListener("click", () => this.startMode(button.dataset.mode));
        });
    }

    async aiMove() {
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
        this.board[point.r * SIZE + point.c] = side;
        this.ui.setBoard(this.board);
        this.ui.setLastMove(point);
        this.updateCounts();
    }

    finishIfWon(point, side) {
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
        document.getElementById("ai-stats-body").innerHTML = `
            <tr id="ai-stats-empty">
                <td colspan="9">开始对局后显示搜索记录</td>
            </tr>
        `;
        document.getElementById("ai-current").textContent = this.mode ? modeText(this.mode) : "等待选择模式。";
    }

    recordMove({ side, point, source, stats = null }) {
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
        document.getElementById("status").textContent = text;
    }

    isAiTurn() {
        if (this.mode === "eve") return true;
        if (this.mode === "pve") return this.turn === WHITE;
        return false;
    }

    showModeMenu() {
        document.getElementById("mode-menu").classList.remove("hidden");
    }

    hideModeMenu() {
        document.getElementById("mode-menu").classList.add("hidden");
    }

    endGame(text) {
        this.setStatus(`${text} 你可以保留棋盘复盘，或再来一局。`);
        document.getElementById("restart-btn").classList.remove("hidden");
    }

    hideRestart() {
        document.getElementById("restart-btn").classList.add("hidden");
    }
}

function modeText(mode) {
    if (mode === "pvp") return "人人模式：黑棋先手。";
    if (mode === "eve") return "机机模式：AI 黑棋先手。";
    return "人机模式：人类黑子先手，AI 白子后手。";
}

function winnerText(side) {
    return side === BLACK ? "黑棋五连，黑棋获胜。" : "白棋五连，白棋获胜。";
}

function hasFive(board, point, side) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    return dirs.some(([dr, dc]) => {
        return 1 + countDir(board, point, side, dr, dc) + countDir(board, point, side, -dr, -dc) >= 5;
    });
}

function countDir(board, point, side, dr, dc) {
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
