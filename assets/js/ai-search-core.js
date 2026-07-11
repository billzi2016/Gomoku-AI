/*
 * AI 并行搜索调度核心。
 *
 * 这个模块只描述“一次局面搜索如何分片、派发、合并”，不关心 Worker 来自
 * 浏览器还是 Node。浏览器实时 AI 和离线开局库生成器都调用这里，避免两套
 * 搜索调度长期分叉。
 */

export async function parallelSearchPosition({ board, isBlackTurn, thinkTimeMs, workerCount, call }) {
    /*
     * 两阶段搜索：
     * 1. 用一次 1ms 搜索拿到 Rust 端排序后的根候选点；
     * 2. 把候选点按轮转方式分给多个 Worker，再合并每个分片的最佳结果。
     *
     * call(index, payload) 是唯一外部依赖。浏览器用 postMessage 调 Web Worker，
     * Node 生成器用 worker_threads，核心算法不需要知道环境差异。
     */
    const cells = new Int8Array(board);
    const candidateResult = await call(0, {
        type: "search",
        cells,
        isBlackTurn,
        thinkTimeMs: 1,
        legalMoves: new Uint8Array()
    });

    const moves = candidateResult.heatmap || [];
    if (!moves.length) return candidateResult;

    const chunks = splitRootMoves(moves, Math.min(workerCount, moves.length));
    const calls = chunks.map((chunk, index) => call(index, {
        type: "search",
        cells,
        isBlackTurn,
        thinkTimeMs,
        legalMoves: encodeMoves(chunk)
    }));

    return mergeSearchResults(await Promise.all(calls), candidateResult, chunks.length);
}

function splitRootMoves(moves, count) {
    /*
     * 轮转分片能把高分、低分候选较均匀地分散到各 Worker。
     * 如果直接连续切块，排在前面的强候选可能集中到一个 Worker，尾部等待会更明显。
     */
    const chunks = Array.from({ length: count }, () => []);
    for (let i = 0; i < moves.length; i++) {
        chunks[i % chunks.length].push(moves[i]);
    }
    return chunks;
}

function encodeMoves(chunk) {
    /*
     * Rust 协议使用单字节根节点索引：row * 15 + col。
     * 五子棋棋盘是 15x15，所以最大索引 224，可以安全放入 Uint8Array。
     */
    const encoded = new Uint8Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
        encoded[i] = chunk[i].r * 15 + chunk[i].c;
    }
    return encoded;
}

function mergeSearchResults(results, fallback, workerCount) {
    let best = null;
    let totalNodes = 0;
    let maxTimeMs = 0;
    let maxDepth = 0;
    const heatmap = [];

    for (const result of results) {
        totalNodes += result.nodes || 0;
        maxTimeMs = Math.max(maxTimeMs, result.timeMs || 0);
        maxDepth = Math.max(maxDepth, result.depth || 0);
        if (result.heatmap) heatmap.push(...result.heatmap);
        if (!best || result.score > best.score) best = result;
    }

    if (!best) return fallback;
    best.nodes = totalNodes;
    best.timeMs = maxTimeMs;
    best.depth = maxDepth;
    best.nps = maxTimeMs > 0 ? Math.round(totalNodes * 1000 / maxTimeMs) : totalNodes;
    best.heatmap = heatmap;
    best.workerCount = workerCount;
    return best;
}
