//! NegaMax 搜索。
//!
//! 搜索使用迭代加深、Alpha-Beta 剪枝和简单置换表。
//! 所有超时返回都通过 `relative_score` 转成当前行动方视角，避免符号错乱。

use std::collections::HashMap;

use crate::board::Board;
use crate::evaluate::relative_score;
use crate::movegen::{generate_candidates, ScoredMove};
use crate::types::{HeatPoint, Move, SearchOutput, EMPTY, INF, SIZE};

const ROOT_LIMIT: usize = 28;
const CHILD_LIMIT: usize = 18;
const MAX_DEPTH: u8 = 12;

struct Context {
    root_side: i8,
    deadline: f64,
    nodes: u64,
    table: HashMap<u64, Entry>,
}

#[derive(Clone, Copy)]
struct Entry {
    depth: u8,
    score: i32,
}

pub fn search_best_move_json(cells: Vec<i8>, side: i8, think_ms: u32, allowed: Vec<u8>) -> String {
    let board = Board::from_cells(&cells);
    let start = js_sys::Date::now();
    let deadline = start + think_ms as f64;
    let roots = root_moves(&board, side, &allowed);

    if roots.is_empty() {
        return encode(SearchOutput {
            r: -1,
            c: -1,
            score: 0,
            depth: 0,
            nodes: 0,
            time_ms: elapsed_ms(start),
            nps: 0,
            heatmap: Vec::new(),
        });
    }

    // AI Manager 会用 1ms 空 allowed 请求拿候选热力图。
    // 该分支只返回静态排序分，不启动递归搜索。
    if allowed.is_empty() && think_ms <= 2 {
        return encode(candidate_only(start, &roots));
    }

    let mut ctx = Context {
        root_side: side,
        deadline,
        nodes: 0,
        table: HashMap::new(),
    };

    let mut best = roots[0].mv;
    let mut best_score = roots[0].order_score;
    let mut best_depth = 0;
    let mut heatmap = roots
        .iter()
        .map(|item| HeatPoint {
            r: item.mv.r,
            c: item.mv.c,
            score: item.order_score,
        })
        .collect::<Vec<_>>();

    for depth in 1..=MAX_DEPTH {
        if timed_out(&ctx) {
            break;
        }
        let mut depth_best = best;
        let mut depth_score = -INF;
        let mut depth_heat = Vec::with_capacity(roots.len());

        for item in &roots {
            if timed_out(&ctx) {
                break;
            }
            let mut next = board.clone();
            next.place(item.mv, side);
            let score = if next.has_five(item.mv, side) {
                INF / 2
            } else {
                -negamax(&next, depth.saturating_sub(1), -side, -INF, INF, &mut ctx)
            };
            depth_heat.push(HeatPoint {
                r: item.mv.r,
                c: item.mv.c,
                score,
            });
            if score > depth_score {
                depth_score = score;
                depth_best = item.mv;
            }
        }

        if !depth_heat.is_empty() {
            best = depth_best;
            best_score = depth_score;
            best_depth = depth;
            heatmap = depth_heat;
        }
    }

    let time_ms = elapsed_ms(start);
    encode(SearchOutput {
        r: best.r as i16,
        c: best.c as i16,
        score: best_score,
        depth: best_depth,
        nodes: ctx.nodes,
        time_ms,
        nps: nps(ctx.nodes, time_ms),
        heatmap,
    })
}

fn negamax(
    board: &Board,
    depth: u8,
    turn_side: i8,
    mut alpha: i32,
    beta: i32,
    ctx: &mut Context,
) -> i32 {
    ctx.nodes += 1;
    if timed_out(ctx) || depth == 0 || board.is_full() {
        return relative_score(board, turn_side, ctx.root_side);
    }

    let key = hash(board, turn_side);
    if let Some(entry) = ctx.table.get(&key) {
        if entry.depth >= depth {
            return entry.score;
        }
    }

    let moves = generate_candidates(board, turn_side, CHILD_LIMIT);
    if moves.is_empty() {
        return relative_score(board, turn_side, ctx.root_side);
    }

    let mut best = -INF;
    for item in moves {
        if timed_out(ctx) {
            return best.max(relative_score(board, turn_side, ctx.root_side));
        }
        let mut next = board.clone();
        next.place(item.mv, turn_side);
        let score = if next.has_five(item.mv, turn_side) {
            INF / 2
        } else {
            -negamax(&next, depth - 1, -turn_side, -beta, -alpha, ctx)
        };
        best = best.max(score);
        alpha = alpha.max(score);
        if alpha >= beta {
            break;
        }
    }

    ctx.table.insert(key, Entry { depth, score: best });
    best
}

fn root_moves(board: &Board, side: i8, allowed: &[u8]) -> Vec<ScoredMove> {
    if allowed.is_empty() {
        return generate_candidates(board, side, ROOT_LIMIT);
    }
    let mut roots = allowed
        .iter()
        .filter_map(|&idx| {
            let r = idx as usize / SIZE;
            let c = idx as usize % SIZE;
            if r >= SIZE || c >= SIZE || board.cells()[idx as usize] != EMPTY {
                return None;
            }
            let mv = Move { r: r as u8, c: c as u8 };
            Some(ScoredMove {
                mv,
                order_score: crate::evaluate::quick_move_score(board, mv, side),
            })
        })
        .collect::<Vec<_>>();
    roots.sort_by(|a, b| b.order_score.cmp(&a.order_score));
    roots
}

fn candidate_only(start: f64, roots: &[ScoredMove]) -> SearchOutput {
    let best = roots[0];
    SearchOutput {
        r: best.mv.r as i16,
        c: best.mv.c as i16,
        score: best.order_score,
        depth: 0,
        nodes: 0,
        time_ms: elapsed_ms(start),
        nps: 0,
        heatmap: roots
            .iter()
            .map(|item| HeatPoint {
                r: item.mv.r,
                c: item.mv.c,
                score: item.order_score,
            })
            .collect(),
    }
}

fn hash(board: &Board, side: i8) -> u64 {
    let mut h: u64 = if side > 0 { 0x9e37_79b9_7f4a_7c15 } else { 0xbf58_476d_1ce4_e5b9 };
    for (idx, &cell) in board.cells().iter().enumerate() {
        let v: u64 = match cell {
            1 => 0x1000_0000_01b3,
            -1 => 0xc6a4_a793_5bd1_e995,
            _ => 0,
        };
        h ^= v.wrapping_mul((idx as u64 + 1).wrapping_mul(0x9e37_79b9));
        h = h.rotate_left(7).wrapping_mul(0x1000_0000_01b3);
    }
    h
}

fn timed_out(ctx: &Context) -> bool {
    js_sys::Date::now() >= ctx.deadline
}

fn elapsed_ms(start: f64) -> u64 {
    (js_sys::Date::now() - start).max(0.0) as u64
}

fn nps(nodes: u64, time_ms: u64) -> u64 {
    if time_ms == 0 {
        nodes
    } else {
        nodes.saturating_mul(1000) / time_ms
    }
}

fn encode(out: SearchOutput) -> String {
    serde_json::to_string(&out).unwrap_or_else(|_| "{\"r\":-1,\"c\":-1}".to_string())
}
