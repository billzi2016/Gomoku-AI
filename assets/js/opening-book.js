/*
 * 开局库运行时模块。
 *
 * 这个文件只负责加载和匹配开局库，不负责生成开局库。
 * 离线生成器输出紧凑 JSON，浏览器运行时做 8 种对称归一化后直接 match。
 */

import { BLACK, EMPTY, SIZE } from "./board-ui.js";

const BOOK_URL = "./assets/opening-book/opening-book.json";

const TRANSFORMS = [
    { map: (r, c) => [r, c], inv: (r, c) => [r, c] },
    { map: (r, c) => [c, SIZE - 1 - r], inv: (r, c) => [SIZE - 1 - c, r] },
    { map: (r, c) => [SIZE - 1 - r, SIZE - 1 - c], inv: (r, c) => [SIZE - 1 - r, SIZE - 1 - c] },
    { map: (r, c) => [SIZE - 1 - c, r], inv: (r, c) => [c, SIZE - 1 - r] },
    { map: (r, c) => [r, SIZE - 1 - c], inv: (r, c) => [r, SIZE - 1 - c] },
    { map: (r, c) => [SIZE - 1 - r, c], inv: (r, c) => [SIZE - 1 - r, c] },
    { map: (r, c) => [c, r], inv: (r, c) => [c, r] },
    { map: (r, c) => [SIZE - 1 - c, SIZE - 1 - r], inv: (r, c) => [SIZE - 1 - c, SIZE - 1 - r] }
];

export class OpeningBook {
    /*
     * 紧凑格式：
     *
     * entries: [[key, moveIndex, score], ...]
     *
     * key 使用规范化后的局面编码；moveIndex 是规范棋盘上的 row * 15 + col。
     * 这样比存 { key, move: [r,c], score } 更省体积，适合后续扩到几千条。
     */
    constructor(entries = []) {
        this.entries = new Map(entries.map(([key, move, score]) => [key, { move, score }]));
    }

    static async load(url = BOOK_URL) {
        try {
            const response = await fetch(url, { cache: "no-cache" });
            if (!response.ok) return new OpeningBook();
            const data = await response.json();
            return new OpeningBook(Array.isArray(data.entries) ? data.entries : []);
        } catch (_error) {
            return new OpeningBook();
        }
    }

    lookup(board, isBlackTurn) {
        const canonical = canonicalizePosition(board, isBlackTurn);
        const entry = this.entries.get(canonical.key);
        if (!entry) return null;

        const move = entry.move;
        const [r, c] = canonical.transform.inv(Math.floor(move / SIZE), move % SIZE);
        const idx = r * SIZE + c;
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || board[idx] !== EMPTY) {
            return null;
        }

        const score = Number.isFinite(entry.score) ? entry.score : 0;
        return {
            r,
            c,
            score,
            depth: 0,
            nodes: 0,
            timeMs: 0,
            nps: 0,
            heatmap: [{ r, c, score }],
            book: true
        };
    }
}

export function canonicalizePosition(board, isBlackTurn) {
    /*
     * 平移 + 对称归一化。
     *
     * 先对局面做 8 种旋转/镜像，再把棋子包围盒平移到棋盘中心附近，
     * 最后选字典序最小的编码。这样同一个局部开局形状即使整体偏移，
     * 也只需要在 JSON 里保存一份。
     */
    let best = null;
    for (const transform of TRANSFORMS) {
        const normalized = normalizeTransform(board, isBlackTurn, transform);
        if (!normalized) continue;
        const { key, shiftR, shiftC } = normalized;
        if (!best || key < best.key) {
            best = {
                key,
                transform: {
                    map: (r, c) => {
                        const [tr, tc] = transform.map(r, c);
                        return [tr + shiftR, tc + shiftC];
                    },
                    inv: (r, c) => transform.inv(r - shiftR, c - shiftC)
                }
            };
        }
    }
    return best || { key: `${isBlackTurn ? "B" : "W"}|`, transform: TRANSFORMS[0] };
}

export function toCanonicalMoveIndex(point, transform) {
    const [r, c] = transform.map(point.r, point.c);
    return r * SIZE + c;
}

function normalizeTransform(board, isBlackTurn, transform) {
    /*
     * 例子：
     *
     * W|B34,W35
     *
     * W 表示白棋行动；B34 表示规范棋盘 index=112 的黑棋。
     * index 用 36 进制，减少结果文件体积。
     */
    const points = [];
    let minR = SIZE;
    let maxR = -1;
    let minC = SIZE;
    let maxC = -1;
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const cell = board[r * SIZE + c];
            if (cell === EMPTY) continue;
            const [tr, tc] = transform.map(r, c);
            points.push({ r: tr, c: tc, cell });
            minR = Math.min(minR, tr);
            maxR = Math.max(maxR, tr);
            minC = Math.min(minC, tc);
            maxC = Math.max(maxC, tc);
        }
    }

    if (!points.length) {
        return { key: `${isBlackTurn ? "B" : "W"}|`, shiftR: 0, shiftC: 0 };
    }

    const height = maxR - minR;
    const width = maxC - minC;
    const targetMinR = 7 - Math.floor(height / 2);
    const targetMinC = 7 - Math.floor(width / 2);
    const shiftR = targetMinR - minR;
    const shiftC = targetMinC - minC;
    const stones = [];
    for (const point of points) {
        const nr = point.r + shiftR;
        const nc = point.c + shiftC;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) {
            return null;
        }
        const idx = nr * SIZE + nc;
        stones.push(`${point.cell === BLACK ? "B" : "W"}${idx.toString(36)}`);
    }
    stones.sort();
    return { key: `${isBlackTurn ? "B" : "W"}|${stones.join(",")}`, shiftR, shiftC };
}
