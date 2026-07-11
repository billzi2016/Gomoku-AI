/*
 * AI Worker 池管理器。
 *
 * 五子棋所有空位都合法，但实际搜索只拆分 Rust 生成的候选点。
 * 管理器负责把候选根节点分配给约 90% CPU 数量的 Worker，并合并最佳结果。
 */

import { OpeningBook } from "./opening-book.js";
import { parallelSearchPosition } from "./ai-search-core.js";

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
        this.openingBook = new OpeningBook();

        for (let i = 0; i < this.workerCount; i++) {
            const worker = new Worker(this.workerUrl, { type: "module" });
            worker.onmessage = (event) => this.handleMessage(event);
            worker.onerror = (event) => this.handleError(event);
            this.workers.push(worker);
        }
    }

    async ready() {
        /*
         * 预热所有 Worker。
         *
         * 每个 Worker 都会独立加载同一个 wasm-bindgen 生成的 JS glue 和 Wasm。
         * ready 完成后，后续搜索不再支付首次加载成本。
         */
        const [book] = await Promise.all([
            OpeningBook.load(),
            ...this.workers.map((_, index) => this.call(index, {
                type: "init",
                wasmUrl: new URL("../wasm/gomoku_ai.js", import.meta.url).href
            }))
        ]);
        this.openingBook = book;
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
         * 先查离线开局库。命中时立即返回 15s 离线搜索得到的结果；
         * 未命中时走和开局库生成器共享的并行搜索调度，网页实时预算仍是 5s。
         */
        const cells = new Int8Array(board);
        const bookResult = this.openingBook.lookup(cells, isBlackTurn);
        if (bookResult) return bookResult;
        return parallelSearchPosition({
            board,
            isBlackTurn,
            thinkTimeMs: this.thinkTimeMs,
            workerCount: this.workerCount,
            call: (index, payload) => this.call(index, payload)
        });
    }

    terminate() {
        // 页面卸载或未来扩展销毁游戏时，可显式释放 Worker。
        for (const worker of this.workers) worker.terminate();
        this.workers = [];
        this.jobs.clear();
    }
}
