/*
 * AI Worker 池管理器。
 *
 * 五子棋所有空位都合法，但实际搜索只拆分 Rust 生成的候选点。
 * 管理器负责把候选根节点分配给约 90% CPU 数量的 Worker，并合并最佳结果。
 */

export class GomokuAIManager {
    /*
     * 创建 Worker 池。
     *
     * 浏览器里没有直接控制“用 90% CPU”的标准 API，所以这里按
     * navigator.hardwareConcurrency 估算线程数，启动约 90% 数量的 Worker。
     */
    constructor(options = {}) {
        this.workerUrl = options.workerUrl || "./assets/js/ai-worker.js";
        this.thinkTimeMs = options.thinkTimeMs || 5000;
        const cores = navigator.hardwareConcurrency || 4;
        this.workerCount = Math.max(1, Math.ceil(cores * 0.9));
        this.workers = [];
        this.jobs = new Map();
        this.nextJobId = 1;

        for (let i = 0; i < this.workerCount; i++) {
            const worker = new Worker(this.workerUrl, { type: "module" });
            worker.onmessage = (event) => this.handleMessage(event);
            worker.onerror = (event) => this.handleError(event);
            this.workers.push(worker);
        }
    }

    ready() {
        /*
         * 预热所有 Worker。
         *
         * 每个 Worker 都会独立加载同一个 wasm-bindgen 生成的 JS glue 和 Wasm。
         * ready 完成后，后续搜索不再支付首次加载成本。
         */
        return Promise.all(this.workers.map((_, index) => this.call(index, {
            type: "init",
            wasmUrl: new URL("../wasm/gomoku_ai.js", import.meta.url).href
        })));
    }

    handleMessage(event) {
        // Worker 返回 jobId，主线程用 jobs Map 找到对应 Promise 并完成它。
        const { jobId, ok, result, error } = event.data;
        const job = this.jobs.get(jobId);
        if (!job) return;
        this.jobs.delete(jobId);
        ok ? job.resolve(result) : job.reject(new Error(error || "AI worker failed"));
    }

    handleError(event) {
        /*
         * 单个 Worker 报错时，当前所有待完成任务都拒绝。
         * 这样 game.js 能捕获错误并解除 thinking 状态，不会卡死在“AI 思考中”。
         */
        for (const [, job] of this.jobs) {
            job.reject(new Error(event.message || "AI worker error"));
        }
        this.jobs.clear();
    }

    call(workerIndex, payload) {
        /*
         * 给指定 Worker 发送一次请求。
         *
         * jobId 是轻量 RPC 协议的关联键；Worker 只需要原样带回 jobId。
         */
        const jobId = this.nextJobId++;
        const worker = this.workers[workerIndex % this.workers.length];
        return new Promise((resolve, reject) => {
            this.jobs.set(jobId, { resolve, reject });
            worker.postMessage({ ...payload, jobId });
        });
    }

    async search({ board, isBlackTurn }) {
        /*
         * 搜索流程分两阶段：
         * 1. 先让 0 号 Worker 用 1ms 请求 Rust 生成根候选和初始热力图；
         * 2. 再把这些根候选平均分片给 Worker 池并行搜索。
         *
         * Rust 端接收的是一维 0..224 索引，不是 (r,c) 二元组。
         */
        const cells = new Int8Array(board);
        const candidateResult = await this.call(0, {
            type: "search",
            cells,
            isBlackTurn,
            thinkTimeMs: 1,
            legalMoves: new Uint8Array()
        });
        const moves = candidateResult.heatmap || [];
        if (!moves.length) return candidateResult;

        const chunks = Array.from({ length: Math.min(this.workerCount, moves.length) }, () => []);
        // 轮转分片，让高低评分候选尽量均匀分到各 Worker，减少长尾等待。
        for (let i = 0; i < moves.length; i++) {
            chunks[i % chunks.length].push(moves[i]);
        }

        const calls = chunks.map((chunk, index) => {
            const encoded = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
                // 协议约定：Rust allowed_moves 是单字节索引 r * 15 + c。
                encoded[i] = chunk[i].r * 15 + chunk[i].c;
            }
            return this.call(index, {
                type: "search",
                cells,
                isBlackTurn,
                thinkTimeMs: this.thinkTimeMs,
                legalMoves: encoded
            });
        });

        const results = await Promise.all(calls);
        let best = null;
        let totalNodes = 0;
        let maxTimeMs = 0;
        let maxDepth = 0;
        const heatmap = [];

        for (const result of results) {
            // 节点数累加，耗时和深度取各 Worker 最大值，最佳落子按 score 取最大。
            totalNodes += result.nodes || 0;
            maxTimeMs = Math.max(maxTimeMs, result.timeMs || 0);
            maxDepth = Math.max(maxDepth, result.depth || 0);
            if (result.heatmap) heatmap.push(...result.heatmap);
            if (!best || result.score > best.score) best = result;
        }

        if (!best) return candidateResult;
        best.nodes = totalNodes;
        best.timeMs = maxTimeMs;
        best.depth = maxDepth;
        best.nps = maxTimeMs > 0 ? Math.round(totalNodes * 1000 / maxTimeMs) : totalNodes;
        best.heatmap = heatmap;
        best.workerCount = chunks.length;
        return best;
    }

    terminate() {
        // 页面卸载或未来扩展销毁游戏时，可显式释放 Worker。
        for (const worker of this.workers) worker.terminate();
        this.workers = [];
        this.jobs.clear();
    }
}
