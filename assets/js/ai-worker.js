/*
 * 单个 AI Worker。
 *
 * Worker 负责加载 Rust/Wasm，并搜索主线程分配给它的一部分根节点。
 * 返回最佳落子、搜索统计和候选热力图分数。
 */

let wasmReady = null;
let searchBestMove = null;

async function initWasm(wasmUrl) {
    /*
     * Worker 内部的 Wasm 懒加载。
     *
     * wasmReady 会缓存 Promise，避免同一个 Worker 收到多次 init 时重复下载或实例化。
     */
    if (wasmReady) return wasmReady;
    wasmReady = import(wasmUrl).then(async (mod) => {
        await mod.default();
        searchBestMove = mod.search_best_move;
    });
    return wasmReady;
}

self.onmessage = async (event) => {
    /*
     * Worker 消息入口。
     *
     * 支持两种消息：
     * - init：加载 Wasm；
     * - search：调用 Rust 导出的 search_best_move，并把 JSON 字符串转回对象。
     */
    const { jobId, type } = event.data;
    try {
        if (type === "init") {
            await initWasm(event.data.wasmUrl);
            self.postMessage({ jobId, ok: true, result: true });
            return;
        }

        if (type === "search") {
            if (!searchBestMove) throw new Error("Wasm AI has not been initialized");
            const result = searchBestMove(
                event.data.cells,
                event.data.isBlackTurn,
                event.data.thinkTimeMs,
                event.data.legalMoves
            );
            self.postMessage({ jobId, ok: true, result: JSON.parse(result) });
            return;
        }

        throw new Error(`Unknown worker message type: ${type}`);
    } catch (err) {
        self.postMessage({ jobId, ok: false, error: err.message || String(err) });
    }
};
