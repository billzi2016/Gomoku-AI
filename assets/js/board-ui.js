/*
 * 棋盘绘制模块。
 *
 * 负责 15x15 棋盘、星位、棋子、AI 热力图和鼠标坐标转换。
 * 这里不包含 AI 搜索逻辑，避免 UI 和引擎耦合。
 */

export const SIZE = 15;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = -1;

const STAR_POINTS = [
    [3, 3], [3, 11], [7, 7], [11, 3], [11, 11]
];

export class BoardUI {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.board = new Int8Array(SIZE * SIZE);
        this.heatmap = [];
        this.lastMove = null;
        this.resize();
        window.addEventListener("resize", () => this.resize());
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(rect.width * scale);
        this.canvas.height = Math.round(rect.height * scale);
        this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
        this.draw();
    }

    setBoard(board) {
        this.board = board;
        this.draw();
    }

    setHeatmap(heatmap) {
        this.heatmap = heatmap || [];
        this.draw();
    }

    setLastMove(move) {
        this.lastMove = move;
        this.draw();
    }

    clear() {
        this.board = new Int8Array(SIZE * SIZE);
        this.heatmap = [];
        this.lastMove = null;
        this.draw();
    }

    pointFromEvent(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const cell = this.cellSize();
        const margin = cell;
        const c = Math.round((x - margin) / cell);
        const r = Math.round((y - margin) / cell);
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
        return { r, c };
    }

    draw() {
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
        this.drawBoard();
        this.drawHeatmap();
        this.drawStones();
        this.drawLastMove();
    }

    drawBoard() {
        const ctx = this.ctx;
        const cell = this.cellSize();
        const margin = cell;
        const end = margin + cell * (SIZE - 1);

        ctx.fillStyle = "#d3a35e";
        ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

        ctx.strokeStyle = "#1d1a14";
        ctx.lineWidth = 1.4;
        for (let i = 0; i < SIZE; i++) {
            const p = margin + i * cell;
            ctx.beginPath();
            ctx.moveTo(margin, p);
            ctx.lineTo(end, p);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(p, margin);
            ctx.lineTo(p, end);
            ctx.stroke();
        }

        ctx.fillStyle = "#25231d";
        for (const [r, c] of STAR_POINTS) {
            const { x, y } = this.toPixel(r, c);
            ctx.beginPath();
            ctx.arc(x, y, Math.max(3, cell * 0.08), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawHeatmap() {
        if (!this.heatmap.length) return;
        const ctx = this.ctx;
        const cell = this.cellSize();
        const scores = this.heatmap.map(item => item.score);
        const min = Math.min(...scores);
        const max = Math.max(...scores);
        const range = Math.max(1, max - min);
        const labelCutoff = min + range * 0.58;

        for (const item of this.heatmap) {
            const value = (item.score - min) / range;
            const { x, y } = this.toPixel(item.r, item.c);
            ctx.fillStyle = heatColor(value);
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }

        for (const item of this.heatmap) {
            const value = (item.score - min) / range;
            const { x, y } = this.toPixel(item.r, item.c);
            if (item.score >= labelCutoff) {
                ctx.fillStyle = value > 0.66 ? "#073b1a" : "#402d00";
                ctx.font = `800 ${Math.max(13, cell * 0.28)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(shortScore(item.score), x, y + cell * 0.015);
            }
        }
    }

    drawStones() {
        const cell = this.cellSize();
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const v = this.board[r * SIZE + c];
                if (v === EMPTY) continue;
                this.drawStone(r, c, v);
            }
        }
    }

    drawStone(r, c, side) {
        const ctx = this.ctx;
        const cell = this.cellSize();
        const { x, y } = this.toPixel(r, c);
        const radius = cell * 0.39;
        const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.1, x, y, radius);
        if (side === BLACK) {
            grad.addColorStop(0, "#555");
            grad.addColorStop(1, "#0d0d0d");
        } else {
            grad.addColorStop(0, "#fff");
            grad.addColorStop(1, "#dcdcdc");
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
        ctx.shadowBlur = cell * 0.08;
        ctx.shadowOffsetY = cell * 0.04;
        ctx.fill();
        ctx.shadowColor = "transparent";
    }

    drawLastMove() {
        if (!this.lastMove) return;
        const ctx = this.ctx;
        const cell = this.cellSize();
        const { x, y } = this.toPixel(this.lastMove.r, this.lastMove.c);
        ctx.strokeStyle = "#2ecc71";
        ctx.lineWidth = Math.max(2, cell * 0.04);
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.45, 0, Math.PI * 2);
        ctx.stroke();
    }

    toPixel(r, c) {
        const cell = this.cellSize();
        return {
            x: cell + c * cell,
            y: cell + r * cell
        };
    }

    cellSize() {
        return this.canvas.clientWidth / (SIZE + 1);
    }
}

function heatColor(value) {
    if (value >= 0.66) return "rgba(55, 210, 104, 0.82)";
    if (value >= 0.33) return "rgba(255, 216, 61, 0.82)";
    return "rgba(238, 80, 64, 0.78)";
}

function shortScore(score) {
    const abs = Math.abs(score);
    if (abs >= 1000000) return `${Math.round(score / 1000000)}M`;
    if (abs >= 1000) return `${Math.round(score / 1000)}k`;
    return `${score}`;
}
