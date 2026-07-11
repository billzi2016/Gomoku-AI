//! 连续冲四算杀。
//!
//! 这个模块只处理 VCF（Victory by Continuous Four，连续冲四胜）。
//! 它和普通 NegaMax 分开，是为了让强制战术有明确边界：只有一方能连续
//! 制造“对手下一手必须堵”的四时，才把它当作确定性战术结果。
//! 普通活三和形状优势仍交给 `evaluate.rs` 与 `search.rs` 处理，避免盲攻。

use crate::board::Board;
use crate::movegen::generate_candidates;
use crate::types::{Move, SIZE};

const VCF_ATTACK_DEPTH: u8 = 4;
const VCF_DEFENSE_DEPTH: u8 = 3;
const VCF_MOVE_LIMIT: usize = 14;
const VCF_NODE_LIMIT: u32 = 12_000;

struct VcfContext {
    // VCF 是根节点辅助判断，必须有单独节点上限，避免拖慢 5 秒主搜索。
    nodes: u32,
    max_nodes: u32,
}

/// 返回根候选点的强制战术分。
///
/// 分数只覆盖确定性很高的情况：
/// - 自己立即五连；
/// - 堵住对手立即五连；
/// - 自己进入 VCF 强制胜；
/// - 当前落子会让对手立即胜或进入 VCF，则作为危险点压低。
pub fn root_forcing_score(board: &Board, mv: Move, side: i8) -> Option<i32> {
    if board.would_win(mv, side) {
        return Some(620_000_000);
    }
    if board.would_win(mv, -side) {
        return Some(580_000_000);
    }

    let mut next = board.clone();
    next.place(mv, side);

    if !immediate_wins(&next, -side, 1).is_empty() {
        return Some(-580_000_000);
    }

    if !immediate_wins(&next, side, 1).is_empty() && vcf_win_limited(&next, side, VCF_ATTACK_DEPTH)
    {
        return Some(540_000_000);
    }

    if vcf_win_limited(&next, -side, VCF_DEFENSE_DEPTH) {
        return Some(-540_000_000);
    }

    None
}

fn vcf_win_limited(board: &Board, attacker: i8, depth: u8) -> bool {
    /*
     * 每次根候选的 VCF 探测都有固定预算。
     *
     * 这样做的原因是：VCF 是增强模块，不是主搜索本身。如果一个复杂局面
     * 暂时证明不了连续冲四，就回到 NegaMax，而不是把时间全耗在算杀上。
     */
    let mut ctx = VcfContext {
        nodes: 0,
        max_nodes: VCF_NODE_LIMIT,
    };
    has_vcf_win(board, attacker, depth, &mut ctx)
}

fn has_vcf_win(board: &Board, attacker: i8, depth: u8, ctx: &mut VcfContext) -> bool {
    /*
     * VCF 递归定义：
     *
     * 1. 如果攻击方当前有一步五连，已经证明胜利。
     * 2. 攻击方只能选择“落子后产生直接成五点”的冲四招法。
     * 3. 防守方只能堵这些直接成五点。
     * 4. 只要存在一个攻击招法，使防守方所有堵法之后攻击方仍能继续 VCF，
     *    就说明这是强制胜。
     */
    ctx.nodes += 1;
    if ctx.nodes > ctx.max_nodes {
        return false;
    }
    if !immediate_wins(board, attacker, 1).is_empty() {
        return true;
    }
    if depth == 0 {
        return false;
    }

    for mv in forcing_moves(board, attacker) {
        if ctx.nodes > ctx.max_nodes {
            return false;
        }
        let mut next = board.clone();
        next.place(mv, attacker);
        if next.would_win(mv, attacker) {
            return true;
        }

        let defenses = immediate_wins(&next, attacker, 4);
        if defenses.is_empty() {
            continue;
        }

        let mut all_defenses_fail = true;
        for block in defenses {
            let mut reply = next.clone();
            reply.place(block, -attacker);
            if reply.would_win(block, -attacker) || !has_vcf_win(&reply, attacker, depth - 1, ctx) {
                all_defenses_fail = false;
                break;
            }
        }
        if all_defenses_fail {
            return true;
        }
    }

    false
}

fn forcing_moves(board: &Board, attacker: i8) -> Vec<Move> {
    /*
     * VCF 只展开冲四候选。
     *
     * 普通候选生成仍负责邻域裁剪和排序；这里再过滤一次，要求落子后
     * 至少产生一个“下一手可直接成五”的点，才算连续冲四链的一环。
     */
    let mut out = Vec::new();
    for item in generate_candidates(board, attacker, VCF_MOVE_LIMIT) {
        let mut next = board.clone();
        next.place(item.mv, attacker);
        if next.would_win(item.mv, attacker) || !immediate_wins(&next, attacker, 1).is_empty() {
            out.push(item.mv);
        }
    }
    out
}

fn immediate_wins(board: &Board, side: i8, stop_at: usize) -> Vec<Move> {
    /*
     * 找到 side 当前所有一步成五点。
     *
     * 这里扫 15x15 全盘是有意的：一步成五是最高优先级战术，不能因为邻域
     * 裁剪漏掉。判断本身使用 `Board::would_win()`，仍然走 Bitboard。
     */
    let mut wins = Vec::new();
    for r in 0..SIZE {
        for c in 0..SIZE {
            let r = r as i16;
            let c = c as i16;
            if !board.is_empty_point(r, c) {
                continue;
            }
            let mv = Move {
                r: r as u8,
                c: c as u8,
            };
            if board.would_win(mv, side) {
                wins.push(mv);
                if wins.len() >= stop_at {
                    return wins;
                }
            }
        }
    }
    wins
}
