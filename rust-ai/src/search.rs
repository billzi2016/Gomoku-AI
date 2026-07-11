//! NegaMax 搜索。
//!
//! 搜索使用迭代加深、Alpha-Beta 剪枝和简单置换表。
//! 所有超时返回都通过 `relative_score` 转成当前行动方视角，避免符号错乱。

use crate::board::Board;
use crate::evaluate::{relative_score, root_tactical_score};
use crate::movegen::{generate_candidates, ScoredMove};
use crate::threat::root_forcing_score;
use crate::types::{HeatPoint, Move, SearchOutput, EMPTY, INF, SIZE};

// 根节点多保留一些候选，避免主动进攻点在热力图分片前被截掉。
const ROOT_LIMIT: usize = 36;
// 子节点宽度略放大，让 Alpha-Beta 有机会验证进攻后的反击，而不是只看局部评分。
const CHILD_LIMIT: usize = 22;
const MAX_DEPTH: u8 = 12;
const TT_SIZE: usize = 1 << 18;

struct Context {
    // root_side 固定为本次搜索方，用于把叶子评估转换成正确视角。
    root_side: i8,
    // deadline 用浏览器时间戳表示，所有递归层共享同一个超时点。
    deadline: f64,
    // 递归层采样到超时后置 true，避免每个节点都跨 Wasm 边界调用 Date::now。
    stopped: bool,
    // 节点计数用于 UI 展示 NPS，也能帮助观察棋力/性能变化。
    nodes: u64,
    // 固定大小置换表：避免 HashMap 在 Wasm 堆上反复扩容和 rehash。
    table: Vec<Option<Entry>>,
}

#[derive(Clone, Copy)]
struct Entry {
    // 保存完整 key，避免固定槽位碰撞时误用其他局面的分数。
    key: u64,
    // 只有缓存深度不浅于当前请求深度时才复用。
    depth: u8,
    score: i32,
    flag: HashFlag,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum HashFlag {
    Exact,
    Upper,
    Lower,
}

pub fn search_best_move_json(cells: Vec<i8>, side: i8, think_ms: u32, allowed: Vec<u8>) -> String {
    /*
     * 搜索入口。
     *
     * allowed 为空表示由 Rust 自己生成根候选；非空表示 JS Worker 池已经
     * 把根候选分片，本 Worker 只搜索分到的那一批。
     */
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
        stopped: false,
        nodes: 0,
        table: vec![None; TT_SIZE],
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
        /*
         * 迭代加深。
         *
         * 每完成一层就保留当前最佳结果。即使 5 秒时间到，也能返回上一层
         * 已完整搜索过的最优解，而不是返回半截搜索中的不稳定结果。
         */
        if ctx.stopped || timed_out(&ctx) {
            break;
        }
        let mut depth_best = best;
        let mut depth_score = -INF;
        let mut depth_heat = Vec::with_capacity(roots.len());

        let mut completed_roots = 0;
        for item in &roots {
            if ctx.stopped || timed_out(&ctx) {
                break;
            }
            let mut next = board.clone();
            next.place(item.mv, side);
            let score = if let Some(tactical) = root_forcing_score(&board, item.mv, side) {
                /*
                 * VCF 先于普通根节点战术。
                 *
                 * 这样能避免一个看似主动的强制四，实际上让对手下一手进入
                 * 连续冲四胜。只有 VCF 无法证明时，才回到普通根节点评分。
                 */
                tactical
            } else if let Some(tactical) = root_tactical_score(&board, item.mv, side) {
                // 根节点再处理“双成五点 / 强制四”等局部强战术。
                tactical
            } else if next.has_five(item.mv, side) {
                INF / 2
            } else {
                -negamax(&next, depth.saturating_sub(1), -side, -INF, INF, &mut ctx)
            };
            if ctx.stopped {
                break;
            }
            depth_heat.push(HeatPoint {
                r: item.mv.r,
                c: item.mv.c,
                score,
            });
            completed_roots += 1;
            if score > depth_score {
                depth_score = score;
                depth_best = item.mv;
            }
        }

        if completed_roots == roots.len() {
            best = depth_best;
            best_score = depth_score;
            best_depth = depth;
            heatmap = depth_heat;
        } else {
            break;
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
    /*
     * NegaMax 递归。
     *
     * 返回值永远表示“当前行动方 turn_side 的视角”。
     * 因此递归回来要取负号，超时和叶子也必须用 relative_score。
     */
    ctx.nodes += 1;
    if sample_timeout(ctx) || depth == 0 || board.is_full() {
        return relative_score(board, turn_side, ctx.root_side);
    }

    let key = hash(board, turn_side);
    let alpha_orig = alpha;
    if let Some(entry) = tt_get(&ctx.table, key, depth) {
        /*
         * Alpha-Beta 中被剪枝的节点不一定是精确分。
         * Exact 可以直接返回；Lower/Upper 只有在能证明当前窗口会失败时才能截断。
         */
        match entry.flag {
            HashFlag::Exact => return entry.score,
            HashFlag::Lower if entry.score >= beta => return entry.score,
            HashFlag::Upper if entry.score <= alpha => return entry.score,
            _ => {}
        }
    }

    let moves = generate_candidates(board, turn_side, CHILD_LIMIT);
    // 没有候选点通常意味着棋盘已满或局面异常，返回当前静态估值兜底。
    if moves.is_empty() {
        return relative_score(board, turn_side, ctx.root_side);
    }

    let mut best = -INF;
    for item in moves {
        if ctx.stopped {
            // 超时不能随便返回 root 视角分数，否则 NegaMax 符号会被污染。
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

    let flag = if best <= alpha_orig {
        HashFlag::Upper
    } else if best >= beta {
        HashFlag::Lower
    } else {
        HashFlag::Exact
    };
    tt_store(
        &mut ctx.table,
        Entry {
            key,
            depth,
            score: best,
            flag,
        },
    );
    best
}

fn tt_get(table: &[Option<Entry>], key: u64, depth: u8) -> Option<Entry> {
    let entry = table[tt_index(key)]?;
    if entry.key == key && entry.depth >= depth {
        Some(entry)
    } else {
        None
    }
}

fn tt_store(table: &mut [Option<Entry>], entry: Entry) {
    /*
     * 深度优先替换。
     *
     * 固定槽位会有碰撞；更深的结果更贵也更可靠，所以保留深度不低于旧值的条目。
     */
    let index = tt_index(entry.key);
    if table[index].map_or(true, |old| entry.depth >= old.depth) {
        table[index] = Some(entry);
    }
}

fn tt_index(key: u64) -> usize {
    (key as usize) & (TT_SIZE - 1)
}

fn root_moves(board: &Board, side: i8, allowed: &[u8]) -> Vec<ScoredMove> {
    /*
     * 生成当前 Worker 要搜索的根节点。
     *
     * allowed 非空时来自 JS 的分片，编码为单字节索引 r * 15 + c。
     * 这里仍然重新计算排序分，让每个 Worker 内部按强候选优先搜索。
     */
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
            let mv = Move {
                r: r as u8,
                c: c as u8,
            };
            Some(ScoredMove {
                mv,
                order_score: crate::evaluate::quick_move_score(board, mv, side),
            })
        })
        .collect::<Vec<_>>();
    roots.sort_unstable_by(|a, b| b.order_score.cmp(&a.order_score));
    roots
}

fn candidate_only(start: f64, roots: &[ScoredMove]) -> SearchOutput {
    /*
     * 仅返回候选热力图。
     *
     * JS 搜索前会用 1ms 请求触发这个分支，以便拿到根候选并分片给 Worker。
     */
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
    /*
     * 轻量棋盘哈希。
     *
     * 这里不是严格 Zobrist 表，但足以把棋盘内容和行动方混合成置换表 key。
     * 哈希只混合黑白 Bitboard 的 8 个 u64，不再扫描 225 个数组格子。
     */
    let mut h: u64 = if side > 0 {
        0x9e37_79b9_7f4a_7c15
    } else {
        0xbf58_476d_1ce4_e5b9
    };
    let (black, white) = board.bitboards();
    for i in 0..4 {
        h ^= black[i].wrapping_mul(0x1000_0000_01b3 ^ (i as u64 + 1));
        h = h.rotate_left(7).wrapping_mul(0x1000_0000_01b3);
        h ^= white[i].wrapping_mul(0xc6a4_a793_5bd1_e995 ^ (i as u64 + 11));
        h = h.rotate_left(11).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    }
    h
}

fn timed_out(ctx: &Context) -> bool {
    // 所有递归层都用同一个 deadline，保证总思考时间受控。
    js_sys::Date::now() >= ctx.deadline
}

fn sample_timeout(ctx: &mut Context) -> bool {
    /*
     * 递归层超时采样。
     *
     * Date::now() 是 Wasm 调 JS，成本比普通整数运算高很多。
     * 每 1024 个节点检查一次，5 秒搜索的误差通常只有几毫秒，
     * 但可以明显减少热路径上的跨边界调用。
     */
    if ctx.stopped {
        return true;
    }
    if (ctx.nodes & 1023) == 0 {
        ctx.stopped = js_sys::Date::now() >= ctx.deadline;
    }
    ctx.stopped
}

fn elapsed_ms(start: f64) -> u64 {
    // Date::now 返回 f64 毫秒，UI 展示用整数毫秒。
    (js_sys::Date::now() - start).max(0.0) as u64
}

fn nps(nodes: u64, time_ms: u64) -> u64 {
    // time_ms 为 0 时避免除零，直接用节点数作为瞬时 NPS。
    if time_ms == 0 {
        nodes
    } else {
        nodes.saturating_mul(1000) / time_ms
    }
}

fn encode(out: SearchOutput) -> String {
    // wasm-bindgen 传复杂结构不如 JSON 稳定，前端统一 JSON.parse。
    serde_json::to_string(&out).unwrap_or_else(|_| "{\"r\":-1,\"c\":-1}".to_string())
}
