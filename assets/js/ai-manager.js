/*
 * AI Worker 池管理器。
 *
 * 五子棋所有空位都合法，但实际搜索只拆分 Rust 生成的候选点。
 * 管理器负责把候选根节点分配给约 90% CPU 数量的 Worker，并合并最佳结果。
 */

export class GomokuAIManager {
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
        return Promise.all(this.workers.map((_, index) => this.call(index, {
            type: "init",
            wasmUrl: new URL("../wasm/gomoku_ai.js", import.meta.url).href
        })));
    }

    handleMessage(event) {
        const { jobId, ok, result, error } = event.data;
        const job = this.jobs.get(jobId);
        if (!job) return;
        this.jobs.delete(jobId);
        ok ? job.resolve(result) : job.reject(new Error(error || "AI worker failed"));
    }

    handleError(event) {
        for (const [, job] of this.jobs) {
            job.reject(new Error(event.message || "AI worker error"));
        }
        this.jobs.clear();
    }

    call(workerIndex, payload) {
        const jobId = this.nextJobId++;
        const worker = this.workers[workerIndex % this.workers.length];
        return new Promise((resolve, reject) => {
            this.jobs.set(jobId, { resolve, reject });
            worker.postMessage({ ...payload, jobId });
        });
    }

    async search({ board, isBlackTurn }) {
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
        for (let i = 0; i < moves.length; i++) {
            chunks[i % chunks.length].push(moves[i]);
        }

        const calls = chunks.map((chunk, index) => {
            const encoded = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
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
        for (const worker of this.workers) worker.terminate();
        this.workers = [];
        this.jobs.clear();
    }
}
