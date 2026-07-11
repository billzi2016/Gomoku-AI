/* tslint:disable */
/* eslint-disable */

/**
 * 搜索最佳落子并返回 JSON 字符串。
 *
 * `cells` 使用 15x15 一维数组：黑棋 1、白棋 -1、空点 0。
 * `is_black_turn` 表示当前搜索方；人机模式下人类黑棋，AI 白棋。
 * `allowed_moves` 为空时由 Rust 生成根候选；非空时只搜索这些根节点，
 * 方便 JS Worker 池把根节点分片并行。
 */
export function search_best_move(cells: Int8Array, is_black_turn: boolean, think_time_ms: number, allowed_moves: Uint8Array): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly search_best_move: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
