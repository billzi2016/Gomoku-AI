/*
 * 离线开局库生成器。
 *
 * 运行方式：
 * node tools/opening-book/generate-opening-book.mjs --think-ms 15000 --max-entries 500 --max-ply 8 --radius 4 --branch 8 --activate
 *
 * 队列、去重和保存逻辑只存在 tools/opening-book；真正的一步棋并行搜索复用
 * assets/js/ai-search-core.js，避免离线生成器和网页实时 AI 走两套算法。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { parallelSearchPosition } from "../../assets/js/ai-search-core.js";
import { canonicalizePosition, toCanonicalMoveIndex } from "../../assets/js/opening-book.js";

const SIZE = 15;
const BLACK = 1;
const WHITE = -1;
const EMPTY = 0;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOK_DIR = path.join(ROOT, "assets/opening-book");
const RUN_DIR = path.join(BOOK_DIR, "runs");
const MANIFEST = path.join(BOOK_DIR, "manifest.json");
const WORKER_URL = new URL("./search-worker.mjs", import.meta.url);

const args = parseArgs(process.argv.slice(2));
const thinkMs = Number(args["think-ms"] || 15000);
const maxEntries = Number(args["max-entries"] || 500);
const maxPly = Number(args["max-ply"] || 8);
const radius = Number(args.radius || 4);
const branch = Number(args.branch || 8);
const workerCount = positiveNumber(args.workers, defaultWorkerCount());
const activate = Boolean(args.activate);
const runName = safeRunName(args.out || buildRunName());
const runRel = `runs/${runName}`;
const runPath = path.join(RUN_DIR, runName);

const entries = new Map();
const visited = new Set();
const queued = new Set();
const queue = [];
let pool = null;

async function addSearchedEntry(board, side, label) {
    const isBlackTurn = side === BLACK;
    const canonical = canonicalizePosition(board, isBlackTurn);
    if (entries.has(canonical.key)) {
        return canonicalMoveToPoint(entries.get(canonical.key)[1], canonical.transform);
    }

    const started = Date.now();
    const beforeQueue = queue.length;
    const stoneCount = stones(board);
    console.log(`[start] ${entries.size + 1}/${maxEntries} ${label} ply=${stoneCount} side=${isBlackTurn ? "B" : "W"} queue=${beforeQueue} key=${shortKey(canonical.key)}`);

    const result = await parallelSearchPosition({
        board,
        isBlackTurn,
        thinkTimeMs: thinkMs,
        workerCount: pool.workerCount,
        call: (index, payload) => pool.call(index, payload)
    });
    if (result.r < 0 || result.c < 0) {
        console.log(`[skip] ${label} no-move elapsed=${Date.now() - started}ms`);
        return null;
    }

    const point = { r: result.r, c: result.c };
    if (!isAllowedOpeningMove(point, board)) {
        console.log(`[skip] ${label} edge move=${result.r},${result.c} elapsed=${Date.now() - started}ms`);
        return null;
    }

    const move = toCanonicalMoveIndex(point, canonical.transform);
    const packed = [canonical.key, move, result.score | 0];
    entries.set(canonical.key, packed);
    const elapsed = Date.now() - started;
    const estimatedBytes = estimateBytes(entries);
    console.log([
        `[done] ${entries.size}/${maxEntries}`,
        `${label}`,
        `side=${isBlackTurn ? "B" : "W"}`,
        `move=${result.r},${result.c}`,
        `score=${result.score}`,
        `depth=${result.depth}`,
        `nodes=${result.nodes}`,
        `nps=${result.nps}`,
        `elapsed=${elapsed}ms`,
        `queue=${queue.length}`,
        `json~${formatBytes(estimatedBytes)}`
    ].join(" "));
    return point;
}

async function loadExistingRun() {
    /*
     * 断点续算只读取同参数 run 文件。
     * 参数不同会得到不同文件名，因此不会把不同预算或树形配置混在一起。
     */
    try {
        const raw = await fs.readFile(runPath, "utf8");
        const data = JSON.parse(raw);
        if (!Array.isArray(data.entries)) return 0;
        for (const entry of data.entries) {
            if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
            entries.set(entry[0], entry);
            visited.add(entry[0]);
            queued.add(entry[0]);
        }
        if (Array.isArray(data.frontier)) {
            for (const encoded of data.frontier) {
                const state = decodeState(encoded);
                if (!state) continue;
                enqueue(state.board, state.side, state.ply);
            }
        }
        return entries.size;
    } catch (error) {
        if (error && error.code === "ENOENT") return 0;
        throw error;
    }
}

async function writeRunFile() {
    const output = makeOutput();
    await fs.mkdir(RUN_DIR, { recursive: true });
    await writeJsonAtomic(runPath, output);
}

async function writeManifest() {
    const manifest = {
        v: 1,
        active: runRel,
        updatedAt: new Date().toISOString()
    };
    await fs.mkdir(BOOK_DIR, { recursive: true });
    await writeJsonAtomic(MANIFEST, manifest);
}

async function writeJsonAtomic(file, data) {
    /*
     * 先写临时文件，再 rename 覆盖目标。
     * 这样中断时不容易留下半截 JSON，下一次 resume 更可靠。
     */
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(data)}\n`);
    await fs.rename(tmp, file);
}

function makeOutput() {
    return {
        v: 1,
        size: SIZE,
        rule: "freestyle",
        generatedBy: "tools/opening-book/generate-opening-book.mjs",
        thinkMs,
        maxEntries,
        maxPly,
        centerRadius: radius,
        branch,
        format: "entries: [canonicalKey, canonicalMoveIndex, score]",
        entries: [...entries.values()],
        frontier: queue.map(encodeState)
    };
}

class NodeWorkerPool {
    /*
     * Node 侧 Worker 池。
     *
     * 它只实现和浏览器 AIManager.call() 相同的轻量 RPC 接口，让共享调度
     * 可以无差别调用。搜索策略不写在这里。
     */
    constructor(count) {
        this.workerCount = Math.max(1, count);
        this.workers = [];
        this.jobs = new Map();
        this.nextJobId = 1;

        for (let i = 0; i < this.workerCount; i++) {
            const worker = new Worker(WORKER_URL, { type: "module" });
            worker.on("message", (message) => this.handleMessage(message));
            worker.on("error", (error) => this.handleError(error));
            this.workers.push(worker);
        }
    }

    ready() {
        return Promise.all(this.workers.map((_, index) => this.call(index, { type: "init" })));
    }

    call(workerIndex, payload) {
        const jobId = this.nextJobId++;
        const worker = this.workers[workerIndex % this.workers.length];
        return new Promise((resolve, reject) => {
            this.jobs.set(jobId, { resolve, reject });
            worker.postMessage({ ...payload, jobId });
        });
    }

    handleMessage(message) {
        const { jobId, ok, result, error } = message;
        const job = this.jobs.get(jobId);
        if (!job) return;
        this.jobs.delete(jobId);
        ok ? job.resolve(result) : job.reject(new Error(error || "opening-book worker failed"));
    }

    handleError(error) {
        for (const [, job] of this.jobs) {
            job.reject(error);
        }
        this.jobs.clear();
    }

    async terminate() {
        await Promise.all(this.workers.map((worker) => worker.terminate()));
        this.workers = [];
        this.jobs.clear();
    }
}

function enqueue(board, side, ply) {
    /*
     * 入队前做和运行时一致的规范化 match。
     *
     * 这样旋转、镜像、平移等价局面只会被搜索一次，不浪费 15s 深搜预算。
     */
    const key = canonicalizePosition(board, side === BLACK).key;
    if (queued.has(key) || visited.has(key)) return false;
    queued.add(key);
    queue.push({ board, side, ply });
    return true;
}

function centerCandidates(board, r) {
    const out = [];
    for (let row = 7 - r; row <= 7 + r; row++) {
        for (let col = 7 - r; col <= 7 + r; col++) {
            const idx = row * SIZE + col;
            if (board[idx] !== EMPTY) continue;
            out.push({ r: row, c: col });
        }
    }
    return out.sort((a, b) => centerDistance(a) - centerDistance(b));
}

function isAllowedOpeningMove(point, board) {
    /*
     * 早期开局拒绝边缘污染。局面越深，允许范围稍微放宽。
     */
    const used = stones(board);
    const allowedRadius = used < 4 ? radius + 1 : radius + 2;
    return Math.abs(point.r - 7) <= allowedRadius && Math.abs(point.c - 7) <= allowedRadius;
}

function canonicalMoveToPoint(move, transform) {
    const [r, c] = transform.inv(Math.floor(move / SIZE), move % SIZE);
    return { r, c };
}

function parseArgs(items) {
    const out = {};
    for (let i = 0; i < items.length; i++) {
        if (!items[i].startsWith("--")) continue;
        out[items[i].slice(2)] = items[i + 1] && !items[i + 1].startsWith("--") ? items[++i] : true;
    }
    return out;
}

function positiveNumber(value, fallback) {
    /*
     * Shell 脚本不传 --workers 时走默认 90% CPU。
     * 只有用户显式传入正数时才覆盖，避免 "0" 这类占位值把 Worker 池压成单线程。
     */
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function buildRunName() {
    return [
        "book",
        `t${thinkMs}`,
        `e${maxEntries}`,
        `p${maxPly}`,
        `r${radius}`,
        `b${branch}`,
        "v1"
    ].join("-") + ".json";
}

function safeRunName(value) {
    /*
     * --out 只允许传文件名，不能带目录。
     * 生成器统一写入 assets/opening-book/runs/，避免误写到项目其他位置。
     */
    const name = String(value || "").trim();
    if (/^[A-Za-z0-9._-]+\.json$/.test(name)) return name;
    throw new Error(`Invalid run filename: ${value}`);
}

function defaultWorkerCount() {
    /*
     * 和网页端保持同一思路：默认使用约 90% 本机线程。
     * Node 端可以用 WORKERS/--workers 显式覆盖，方便长时间生成时控制噪声和温度。
     */
    const cores = typeof os.availableParallelism === "function"
        ? os.availableParallelism()
        : os.cpus().length;
    return Math.max(1, Math.ceil(cores * 0.9));
}

function place(board, point, side) {
    board[point.r * SIZE + point.c] = side;
}

function seedInitialQueue() {
    const empty = new Int8Array(SIZE * SIZE);
    enqueue(empty, BLACK, 0);
    for (const firstMove of centerCandidates(empty, radius)) {
        const board = new Int8Array(SIZE * SIZE);
        place(board, firstMove, BLACK);
        enqueue(board, WHITE, 1);
    }
}

function encodeState(state) {
    return [encodeBoard(state.board), state.side, state.ply];
}

function decodeState(value) {
    if (!Array.isArray(value) || value.length !== 3) return null;
    const board = decodeBoard(value[0]);
    const side = Number(value[1]);
    const ply = Number(value[2]);
    if (!board || (side !== BLACK && side !== WHITE) || !Number.isInteger(ply)) return null;
    return { board, side, ply };
}

function encodeBoard(board) {
    const stones = [];
    for (let i = 0; i < board.length; i++) {
        const cell = board[i];
        if (cell === EMPTY) continue;
        stones.push(`${cell === BLACK ? "B" : "W"}${i.toString(36)}`);
    }
    return stones.join(",");
}

function decodeBoard(value) {
    if (typeof value !== "string") return null;
    const board = new Int8Array(SIZE * SIZE);
    if (!value) return board;
    for (const token of value.split(",")) {
        const side = token[0] === "B" ? BLACK : token[0] === "W" ? WHITE : 0;
        const index = Number.parseInt(token.slice(1), 36);
        if (!side || !Number.isInteger(index) || index < 0 || index >= board.length) return null;
        board[index] = side;
    }
    return board;
}

function centerDistance(point) {
    return Math.abs(point.r - 7) + Math.abs(point.c - 7);
}

function stones(board) {
    let total = 0;
    for (const cell of board) {
        if (cell !== EMPTY) total++;
    }
    return total;
}

function shortKey(key) {
    return key.length > 72 ? `${key.slice(0, 69)}...` : key;
}

function estimateBytes(map) {
    return Buffer.byteLength(JSON.stringify([...map.values()]));
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

async function main() {
    /*
     * 主流程放在文件末尾调用，确保 NodeWorkerPool class 和所有工具函数
     * 都已经完成初始化。这样不会踩 ES module 里 class 的暂时性死区。
     */
    console.log([
        "opening-book generation",
        `thinkMs=${thinkMs}`,
        `workers=${workerCount}`,
        `maxEntries=${maxEntries}`,
        `maxPly=${maxPly}`,
        `radius=${radius}`,
        `branch=${branch}`,
        `run=${runRel}`,
        `activate=${activate ? "yes" : "no"}`
    ].join(" "));

    const resumed = await loadExistingRun();
    console.log(`resumeEntries=${resumed} output=${path.relative(ROOT, runPath)}`);

    if (!queue.length) {
        seedInitialQueue();
    }

    try {
        pool = new NodeWorkerPool(workerCount);
        await pool.ready();

        while (queue.length && entries.size < maxEntries) {
            const state = queue.shift();
            const key = canonicalizePosition(state.board, state.side === BLACK).key;
            if (visited.has(key)) continue;
            visited.add(key);

            const best = await addSearchedEntry(state.board, state.side, `ply-${state.ply}`);
            if (!best || state.ply + 1 >= maxPly) {
                await writeRunFile();
                continue;
            }

            /*
             * 为了覆盖常见人类变化，不只沿最佳线走。先把当前方最佳手落下，
             * 再枚举对手在中心区域的若干合理回应，继续生成下一批 position。
             */
            const afterBest = new Int8Array(state.board);
            place(afterBest, best, state.side);
            const nextSide = -state.side;
            if (state.ply + 1 >= maxPly) continue;

            for (const reply of centerCandidates(afterBest, radius).slice(0, branch)) {
                const next = new Int8Array(afterBest);
                place(next, reply, nextSide);
                enqueue(next, state.side, state.ply + 2);
            }
            await writeRunFile();
        }
    } finally {
        if (pool) await pool.terminate();
    }

    await writeRunFile();
    console.log(`wrote ${entries.size} entries to ${path.relative(ROOT, runPath)}`);
    if (activate) {
        await writeManifest();
        console.log(`activated ${runRel} in ${path.relative(ROOT, MANIFEST)}`);
    }
}

await main();
