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
    /*
     * Canvas 棋盘视图。
     *
     * 这个类只做绘制和鼠标坐标转换，不保存规则状态，也不调用 AI。
     * 这样 UI 层可以被 game.js 控制，搜索层可以独立替换。
     */
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
        /*
         * 适配高 DPI 屏幕。
         *
         * CSS 控制 canvas 的显示尺寸，真实像素尺寸按 devicePixelRatio 放大，
         * 再用 setTransform 把绘图坐标映射回 CSS 像素，避免棋盘在 Retina 屏发糊。
         */
        const rect = this.canvas.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(rect.width * scale);
        this.canvas.height = Math.round(rect.height * scale);
        this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
        this.draw();
    }

    setBoard(board) {
        // 接收外部棋盘数组引用并重绘；数组内容由 game.js 维护。
        this.board = board;
        this.draw();
    }

    setHeatmap(heatmap) {
        /*
         * 设置候选点热力图。
         *
         * heatmap 来自 Rust/Wasm 搜索结果，每个点包含 r、c、score。
         * 这里不解释分数含义，只负责把相对强弱映射成红黄绿。
         */
        this.heatmap = heatmap || [];
        this.draw();
    }

    setLastMove(move) {
        // 记录最后一步，用绿色圆环标记，便于复盘。
        this.lastMove = move;
        this.draw();
    }

    clear() {
        // 新局或回到菜单时清空棋盘、热力图和最后一步标记。
        this.board = new Int8Array(SIZE * SIZE);
        this.heatmap = [];
        this.lastMove = null;
        this.draw();
    }

    pointFromEvent(event) {
        /*
         * 把鼠标点击坐标转换成棋盘交叉点。
         *
         * 五子棋落在交叉点而不是格子中心，所以这里用 Math.round 找最近线交点。
         * 如果点击位置落在棋盘外边界之外，返回 null。
         */
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
        /*
         * 固定绘制顺序：
         * 1. 棋盘线和星位；
         * 2. AI 热力图；
         * 3. 棋子；
         * 4. 最后一步标记。
         *
         * 热力图在棋子下面，避免遮挡已经落下的棋。
         */
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
        this.drawBoard();
        this.drawHeatmap();
        this.drawStones();
        this.drawLastMove();
    }

    drawBoard() {
        // 绘制木纹底色、15x15 网格线和五个传统星位。
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
        /*
         * 绘制 AI 候选热力图。
         *
         * 先画所有圆点，再第二遍画文字。这样数字不会被后续圆点覆盖，
         * 也能保持所有标签视觉居中。
         */
        if (!this.heatmap.length) return;
        const ctx = this.ctx;
        const cell = this.cellSize();
        const scores = this.heatmap.map(item => item.score);
        const min = Math.min(...scores);
        const max = Math.max(...scores);
        const range = Math.max(1, max - min);
        const labelCutoff = min + range * 0.58;

        // 第一遍只画颜色圆点：红低、黄中、绿高。
        for (const item of this.heatmap) {
            const value = (item.score - min) / range;
            const { x, y } = this.toPixel(item.r, item.c);
            ctx.fillStyle = heatColor(value);
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }

        // 第二遍只给较高评分点写数值，低评分点不写，避免棋盘变乱。
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
        // 遍历棋盘数组，把非空位置画成黑白棋子。
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
        /*
         * 绘制单个棋子。
         *
         * 使用径向渐变和轻微阴影，让黑白棋在木色棋盘上有立体感。
         */
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
        // 最后一步只画绿色外环，不改变棋子本身颜色。
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
        // 棋盘四周留一个 cell 的边距，交叉点坐标从 cell 开始。
        const cell = this.cellSize();
        return {
            x: cell + c * cell,
            y: cell + r * cell
        };
    }

    cellSize() {
        // 15 路棋盘有 15 条线，但左右各留一格边距，所以总宽按 SIZE + 1 分。
        return this.canvas.clientWidth / (SIZE + 1);
    }
}

function heatColor(value) {
    // value 已经归一化到 0..1，只负责映射成可读的红黄绿。
    if (value >= 0.66) return "rgba(55, 210, 104, 0.82)";
    if (value >= 0.33) return "rgba(255, 216, 61, 0.82)";
    return "rgba(238, 80, 64, 0.78)";
}

function shortScore(score) {
    // 热力图空间有限，大分数用 k/M 缩写。
    const abs = Math.abs(score);
    if (abs >= 1000000) return `${Math.round(score / 1000000)}M`;
    if (abs >= 1000) return `${Math.round(score / 1000)}k`;
    return `${score}`;
}
