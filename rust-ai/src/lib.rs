//! 五子棋 Rust/Wasm 引擎入口。
//!
//! JavaScript 只负责 UI、Worker 调度和结果展示；这里负责候选点生成、
//! 静态评估、NegaMax Minimax、Alpha-Beta 剪枝、置换表和迭代加深。

mod board;
mod evaluate;
mod movegen;
mod search;
mod types;

use wasm_bindgen::prelude::*;

/// 搜索最佳落子并返回 JSON 字符串。
///
/// `cells` 使用 15x15 一维数组：黑棋 1、白棋 -1、空点 0。
/// `is_black_turn` 表示当前搜索方；人机模式下人类黑棋，AI 白棋。
/// `allowed_moves` 为空时由 Rust 生成根候选；非空时只搜索这些根节点，
/// 方便 JS Worker 池把根节点分片并行。
#[wasm_bindgen]
pub fn search_best_move(
    cells: Vec<i8>,
    is_black_turn: bool,
    think_time_ms: u32,
    allowed_moves: Vec<u8>,
) -> String {
    let side = if is_black_turn { types::BLACK } else { types::WHITE };
    search::search_best_move_json(cells, side, think_time_ms, allowed_moves)
}
