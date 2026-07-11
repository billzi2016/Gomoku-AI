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
        this.over = false;
        this.thinking = false;
        this.generation = 0;
        this.moveIndex = 0;
    }

    async init() {
        await this.ai.ready();
        this.bindBoard();
        this.bindRestart();
        this.reset();
    }

    reset() {
        this.board = new Int8Array(SIZE * SIZE);
        this.over = false;
        this.thinking = false;
        this.generation++;
        this.moveIndex = 0;
        this.ui.clear();
        this.updateCounts();
        this.resetStats();
        this.setStatus("人机：人类黑子先手，AI 白子后手。");
    }

    bindBoard() {
        this.ui.canvas.addEventListener("click", async (event) => {
            if (this.over || this.thinking) return;
            const point = this.ui.pointFromEvent(event);
            if (!point) return;
            const idx = point.r * SIZE + point.c;
            if (this.board[idx] !== EMPTY) return;

            this.place(point, BLACK);
            this.recordMove({ side: BLACK, point, source: "人类" });
            if (this.finishIfWon(point, BLACK)) return;
            await this.aiMove();
        });
    }

    bindRestart() {
        document.getElementById("restart-btn").addEventListener("click", () => this.reset());
    }

    async aiMove() {
        if (this.over || this.thinking) return;
        const generation = this.generation;
        this.thinking = true;
        this.setStatus("AI 正在计算白棋落子...");
        let result;
        try {
            result = await this.ai.search({ board: this.board, isBlackTurn: false });
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
            this.setStatus("棋盘已满，平局。");
            return;
        }

        const point = { r: result.r, c: result.c };
        this.place(point, WHITE);
        this.recordMove({ side: WHITE, point, source: "AI", stats: result });
        this.thinking = false;
        if (this.finishIfWon(point, WHITE)) return;
        this.setStatus("轮到你落黑子。");
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
            this.setStatus(side === BLACK ? "黑棋五连，人类获胜。" : "白棋五连，AI 获胜。");
            return true;
        }
        if (isFull(this.board)) {
            this.over = true;
            this.ui.setHeatmap([]);
            this.setStatus("棋盘已满，平局。");
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
                <td colspan="8">开始对局后显示搜索记录</td>
            </tr>
        `;
        document.getElementById("ai-current").textContent = "人类执黑先手，点击棋盘落子。";
    }

    recordMove({ side, point, source, stats = null }) {
        this.moveIndex++;
        document.getElementById("ai-stats-empty")?.remove();

        const sideText = side === BLACK ? "黑" : "白";
        const score = stats ? formatScore(stats.score) : "-";
        const scoreClass = stats ? scoreClassName(stats.score) : "score-neutral";
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>#${this.moveIndex}</td>
            <td>${sideText}</td>
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
