/*
 * 单个 AI Worker。
 *
 * Worker 负责加载 Rust/Wasm，并搜索主线程分配给它的一部分根节点。
 * 返回最佳落子、搜索统计和候选热力图分数。
 */

let wasmReady = null;
let searchBestMove = null;

async function initWasm(wasmUrl) {
    if (wasmReady) return wasmReady;
    wasmReady = import(wasmUrl).then(async (mod) => {
        await mod.default();
        searchBestMove = mod.search_best_move;
    });
    return wasmReady;
}

self.onmessage = async (event) => {
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
