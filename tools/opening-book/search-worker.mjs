/*
 * Node 版搜索 Worker。
 *
 * 离线开局库生成器需要复用网页同一套 Rust/Wasm 搜索入口，但 Node 没有
 * 浏览器 Web Worker。这个文件只做 worker_threads 适配：加载 Wasm、接收
 * search 请求、返回 JSON 结果，不包含开局库生成策略。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";

import { initSync, search_best_move } from "../../assets/wasm/gomoku_ai.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wasmBytes = fs.readFileSync(path.join(ROOT, "assets/wasm/gomoku_ai_bg.wasm"));

let ready = false;

function ensureReady() {
    /*
     * initSync 只能对当前 Worker 的 Wasm 实例初始化一次。
     * 每个 Node Worker 都有独立模块上下文，所以各 Worker 互不影响。
     */
    if (ready) return;
    initSync({ module: wasmBytes });
    ready = true;
}

parentPort.on("message", (message) => {
    const { jobId, type } = message;
    try {
        ensureReady();
        if (type === "init") {
            parentPort.postMessage({ jobId, ok: true, result: true });
            return;
        }
        if (type !== "search") {
            throw new Error(`Unknown worker message type: ${type}`);
        }

        const result = search_best_move(
            new Int8Array(message.cells),
            Boolean(message.isBlackTurn),
            Number(message.thinkTimeMs),
            new Uint8Array(message.legalMoves || [])
        );
        parentPort.postMessage({ jobId, ok: true, result: JSON.parse(result) });
    } catch (error) {
        parentPort.postMessage({ jobId, ok: false, error: error.message || String(error) });
    }
});
