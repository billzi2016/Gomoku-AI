//! 局面评估。
//!
//! 本模块只做静态评分和单点快速预估，不生成子局面。
//! 搜索排序会先缓存 `quick_move_score` 的结果，避免在排序比较中重复递归或分配。

use crate::board::{in_board, Board};
use crate::types::{Move, EMPTY};

const DIRS: [(i16, i16); 4] = [(1, 0), (0, 1), (1, 1), (1, -1)];
const WIN_NOW: i32 = 40_000_000;
const BLOCK_WIN_NOW: i32 = 35_000_000;
const FORCE_FOUR: i32 = 8_000_000;
const OPEN_THREE: i32 = 1_500_000;
const DOUBLE_THREAT: i32 = 4_500_000;

#[derive(Clone, Copy, Default)]
struct ThreatStats {
    /*
     * 候选点落下后形成的局部威胁统计。
     *
     * best 用于和旧逻辑兼容；force_count/open_three_count 用来识别“双威胁”。
     * 双威胁是五子棋主动进攻的关键：如果一步棋制造两个必须处理的点，
     * 对手通常只能堵一个，下一手就可能进入必胜线。
     */
    best: i32,
    force_count: i32,
    open_three_count: i32,
}

/// 返回 root 方视角的静态分数。
pub fn evaluate(board: &Board, root_side: i8) -> i32 {
    // 评分始终用 root 方减对手方；递归层需要相对视角时走 relative_score。
    score_side(board, root_side) - score_side(board, -root_side)
}

/// 返回当前行动方视角的分数。
///
/// NegaMax 每一层都要求分数站在“当前行动方”视角。
/// 超时、到深度和兜底分支都走这里，避免 root 视角分数污染递归符号。
pub fn relative_score(board: &Board, turn_side: i8, root_side: i8) -> i32 {
    let root_score = evaluate(board, root_side);
    if turn_side == root_side {
        root_score
    } else {
        -root_score
    }
}

/// 单个候选点的排序分。
///
/// 这是 move ordering 的热路径，只看该点四个方向的攻防形状。
/// 这里不能调用搜索、不能生成子局面，也不能计算双方完整候选列表。
pub fn quick_move_score(board: &Board, mv: Move, side: i8) -> i32 {
    /*
     * 先处理最高优先级战术。
     *
     * 这里允许 clone 一个 Board 检查单点成五，因为每个候选点只算一次；
     * 排序比较阶段不会再调用这个函数，不会出现 comparator 重复生成子局面的性能坑。
     */
    if winning_move(board, mv, side) {
        return WIN_NOW;
    }
    if winning_move(board, mv, -side) {
        return BLOCK_WIN_NOW;
    }
    let attack_stats = window_threat_stats(board, mv, side);
    let defend_stats = window_threat_stats(board, mv, -side);
    let attack_threat = attack_stats.best;
    let defend_threat = defend_stats.best;
    let attack_fork = fork_bonus(attack_stats);
    let defend_fork = fork_bonus(defend_stats);

    /*
     * 攻防平衡：
     *
     * 立即输的点必须堵，但“对手普通活三”不能压过自己的强制进攻。
     * 这里按强制程度分层，而不是简单让防守永远大于进攻。
     */
    if attack_threat >= FORCE_FOUR {
        return 34_000_000 + attack_threat + attack_fork;
    }
    if defend_threat >= FORCE_FOUR {
        return 30_000_000 + defend_threat + defend_fork;
    }
    if attack_fork >= DOUBLE_THREAT {
        return 22_000_000 + attack_threat + attack_fork;
    }
    if defend_fork >= DOUBLE_THREAT {
        return 18_000_000 + defend_threat + defend_fork;
    }
    if attack_threat >= OPEN_THREE {
        return 11_000_000 + attack_threat + attack_fork;
    }
    if defend_threat >= OPEN_THREE {
        return 7_000_000 + defend_threat + defend_fork;
    }

    let attack = local_shape_score(board, mv, side);
    let defend = local_shape_score(board, mv, -side);
    center_bonus(mv)
        + attack * 8
        + defend * 4
        + attack_threat * 3
        + defend_threat * 2
        + attack_fork
        + defend_fork / 2
}

/// 根节点战术分。
///
/// 根节点必须优先处理确定性战术：自己能五连就直接赢，
/// 对手下一手能五连就必须堵。强制四也可以作为根节点强战术提前返回。
/// 活三和双威胁只用于排序，不在这里截断搜索，避免没看对手反击就盲攻。
pub fn root_tactical_score(board: &Board, mv: Move, side: i8) -> Option<i32> {
    if winning_move(board, mv, side) {
        return Some(500_000_000);
    }
    if winning_move(board, mv, -side) {
        return Some(450_000_000);
    }
    let attack_stats = window_threat_stats(board, mv, side);
    let defend_stats = window_threat_stats(board, mv, -side);
    let attack_threat = attack_stats.best;
    let defend_threat = defend_stats.best;
    let attack_fork = fork_bonus(attack_stats);
    let defend_fork = fork_bonus(defend_stats);
    if attack_threat >= FORCE_FOUR {
        return Some(300_000_000 + attack_threat + attack_fork);
    }
    if defend_threat >= FORCE_FOUR {
        return Some(270_000_000 + defend_threat + defend_fork);
    }
    None
}

fn score_side(board: &Board, side: i8) -> i32 {
    /*
     * 扫描同色连续线段。
     *
     * 只在一条线段的起点计分：如果前一个点仍是同色，说明这不是线段起点，
     * 直接跳过，避免同一条棋形被重复计入。
     */
    let mut score = 0;
    for r in 0..15 {
        for c in 0..15 {
            if board.get(r, c) != side {
                continue;
            }
            for &(dr, dc) in &DIRS {
                let pr = r - dr;
                let pc = c - dc;
                if in_board(pr, pc) && board.get(pr, pc) == side {
                    continue;
                }
                score += line_score(board, r, c, dr, dc, side);
            }
        }
    }
    score
}

fn line_score(board: &Board, r: i16, c: i16, dr: i16, dc: i16, side: i8) -> i32 {
    // 统计从起点沿方向延伸的连续同色长度，并判断两端是否为空。
    let mut len = 0;
    let mut nr = r;
    let mut nc = c;
    while in_board(nr, nc) && board.get(nr, nc) == side {
        len += 1;
        nr += dr;
        nc += dc;
    }
    if len >= 5 {
        return 20_000_000;
    }

    let open_a = {
        let ar = r - dr;
        let ac = c - dc;
        in_board(ar, ac) && board.get(ar, ac) == EMPTY
    };
    let open_b = in_board(nr, nc) && board.get(nr, nc) == EMPTY;
    pattern_score(len, open_a as i32 + open_b as i32)
}

fn local_shape_score(board: &Board, mv: Move, side: i8) -> i32 {
    /*
     * 计算“如果 side 下在 mv”形成的局部棋形强度。
     *
     * 这个函数只看四个方向的连续长度和开口，不做搜索。
     * 它既用于进攻排序，也用于防守排序：把 side 换成对手即可。
     */
    let mut total = 0;
    for &(dr, dc) in &DIRS {
        let left = count(board, mv, side, -dr, -dc);
        let right = count(board, mv, side, dr, dc);
        let len = 1 + left + right;
        let open_a = open_after(board, mv, side, -dr, -dc, left);
        let open_b = open_after(board, mv, side, dr, dc, right);
        total += pattern_score(len, open_a as i32 + open_b as i32);
    }
    total
}

fn count(board: &Board, mv: Move, side: i8, dr: i16, dc: i16) -> i32 {
    // 从候选点向一个方向数连续同色棋子。
    let mut total = 0;
    let mut r = mv.r as i16 + dr;
    let mut c = mv.c as i16 + dc;
    while in_board(r, c) && board.get(r, c) == side {
        total += 1;
        r += dr;
        c += dc;
    }
    total
}

fn open_after(board: &Board, mv: Move, side: i8, dr: i16, dc: i16, stones: i32) -> bool {
    // 判断连续棋子外侧一格是否为空，空则说明该方向有延展空间。
    let r = mv.r as i16 + dr * (stones as i16 + 1);
    let c = mv.c as i16 + dc * (stones as i16 + 1);
    in_board(r, c) && board.get(r, c) == EMPTY && side != 0
}

fn pattern_score(len: i32, open: i32) -> i32 {
    /*
     * 棋形权重表。
     *
     * 分数不是胜率，而是搜索排序和静态评估的启发式值。
     * 五连和活四必须远高于普通棋形，确保 AI 不会忽视必胜/必堵点。
     */
    match (len, open) {
        (5.., _) => 20_000_000,
        (4, 2) => 3_200_000,
        (4, 1) => 360_000,
        (3, 2) => 110_000,
        (3, 1) => 12_000,
        (2, 2) => 3_500,
        (2, 1) => 600,
        (1, 2) => 80,
        _ => 10,
    }
}

fn window_threat_stats(board: &Board, mv: Move, side: i8) -> ThreatStats {
    /*
     * 5 格窗口威胁识别。
     *
     * local_shape_score 只看连续棋子，容易漏掉断点四/跳三，例如：
     * - XX_XX
     * - XXX_X
     * - X_XXX
     *
     * 这里假设 side 下在 mv，然后枚举四个方向上所有包含 mv 的 5 格窗口。
     * 只要窗口内没有对手棋，就根据己方棋子数、空位数和窗口两端开口给分。
     */
    let mut stats = ThreatStats::default();
    for &(dr, dc) in &DIRS {
        for offset in -4..=0 {
            let sr = mv.r as i16 + dr * offset;
            let sc = mv.c as i16 + dc * offset;
            let score = score_window(board, mv, side, sr, sc, dr, dc);
            stats.best = stats.best.max(score);
            if score >= FORCE_FOUR {
                stats.force_count += 1;
            } else if score >= OPEN_THREE {
                stats.open_three_count += 1;
            }
        }
    }
    stats
}

fn fork_bonus(stats: ThreatStats) -> i32 {
    /*
     * 双威胁奖励。
     *
     * - 两个强制四窗口：通常是直接进入必胜节奏。
     * - 一个强制四加一个活三：对手虽然能堵一边，但另一边会继续扩大。
     * - 两个活三：常见的“双活三”，能把单纯防守方拖进被动。
     *
     * 这里返回独立 bonus，不替代 best。best 保证单个最强窗口仍然有效，
     * bonus 则让“同时制造多个问题”的进攻点排到普通防守前面。
     */
    if stats.force_count >= 2 {
        return 18_000_000;
    }
    if stats.force_count >= 1 && stats.open_three_count >= 1 {
        return 9_000_000;
    }
    if stats.open_three_count >= 2 {
        return DOUBLE_THREAT;
    }
    0
}

fn score_window(
    board: &Board,
    mv: Move,
    side: i8,
    sr: i16,
    sc: i16,
    dr: i16,
    dc: i16,
) -> i32 {
    let mut stones = 0;
    let mut empty = 0;
    for step in 0..5 {
        let r = sr + dr * step;
        let c = sc + dc * step;
        if !in_board(r, c) {
            return 0;
        }
        let cell = if r == mv.r as i16 && c == mv.c as i16 {
            side
        } else {
            board.get(r, c)
        };
        if cell == -side {
            return 0;
        }
        if cell == side {
            stones += 1;
        } else {
            empty += 1;
        }
    }

    let before_open = in_board(sr - dr, sc - dc) && board.get(sr - dr, sc - dc) == EMPTY;
    let after_open = in_board(sr + dr * 5, sc + dc * 5) && board.get(sr + dr * 5, sc + dc * 5) == EMPTY;
    let open = before_open as i32 + after_open as i32;
    match (stones, empty, open) {
        (5, _, _) => 50_000_000,
        (4, 1, 2) => 12_000_000,
        (4, 1, 1) => 8_000_000,
        (4, 1, 0) => 4_000_000,
        (3, 2, 2) => 1_500_000,
        (3, 2, 1) => 450_000,
        (2, 3, 2) => 45_000,
        _ => 0,
    }
}

fn center_bonus(mv: Move) -> i32 {
    // 开局和低深度时轻微偏向中心，但权重远低于任何实际威胁。
    let dr = (mv.r as i32 - 7).abs();
    let dc = (mv.c as i32 - 7).abs();
    120 - (dr + dc) * 8
}

fn winning_move(board: &Board, mv: Move, side: i8) -> bool {
    // 单点落下后是否立即五连，用 Bitboard 临时置位，避免候选排序中 clone 棋盘。
    board.would_win(mv, side)
}
