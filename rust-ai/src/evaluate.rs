//! 局面评估。
//!
//! 本模块只做静态评分和单点快速预估，不生成子局面。
//! 搜索排序会先缓存 `quick_move_score` 的结果，避免在排序比较中重复递归或分配。

use crate::board::{in_board, Board};
use crate::types::{Move, SIZE};

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
    let attack_wins = follow_up_win_count(board, mv, side, 2);
    if attack_wins >= 2 {
        return Some(380_000_000 + attack_wins * 10_000_000);
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

fn follow_up_win_count(board: &Board, mv: Move, side: i8, stop_at: i32) -> i32 {
    /*
     * 根节点追击检测。
     *
     * “双三”真正可怕的地方不是当前分数高，而是落子后会产生多个下一手
     * 直接成五的点。对手一手通常只能堵一个，剩下的点就是继续进攻的入口。
     *
     * 这个函数只在 root_tactical_score 里调用，不进入普通 move ordering
     * comparator，也不在每个子节点反复跑。扫描空点时用 Bitboard 判断空位
     * 和 would_win，避免回到 cells 做棋形判断。
     */
    let mut next = board.clone();
    next.place(mv, side);
    let mut wins = 0;
    for r in 0..SIZE {
        for c in 0..SIZE {
            let r = r as i16;
            let c = c as i16;
            if !next.is_empty_point(r, c) {
                continue;
            }
            let reply = Move {
                r: r as u8,
                c: c as u8,
            };
            if next.would_win(reply, side) {
                wins += 1;
                if wins >= stop_at {
                    return wins;
                }
            }
        }
    }
    wins
}

fn score_side(board: &Board, side: i8) -> i32 {
    /*
     * 扫描同色连续线段。
     *
     * 这里直接遍历该方 Bitboard 的置位点，而不是扫描 225 个 cells。
     * 只在一条线段的起点计分：如果前一个点仍是同色，说明这不是线段起点，
     * 直接跳过，避免同一条棋形被重复计入。
     */
    let mut score = 0;
    let bits = board.bit_words(side);
    for (bucket, mut word) in bits.into_iter().enumerate() {
        while word != 0 {
            let offset = word.trailing_zeros() as usize;
            let idx = bucket * 64 + offset;
            if idx >= SIZE * SIZE {
                break;
            }
            let r = (idx / SIZE) as i16;
            let c = (idx % SIZE) as i16;
            for &(dr, dc) in &DIRS {
                let pr = r - dr;
                let pc = c - dc;
                if board.has_stone(pr, pc, side) {
                    continue;
                }
                score += line_score(board, r, c, dr, dc, side);
            }
            word &= word - 1;
        }
    }
    score + window_score_side(board, side)
}

fn window_score_side(board: &Board, side: i8) -> i32 {
    /*
     * 全局五格窗口评估。
     *
     * 连续线段扫描很快，但它看不懂 XX_XX、XXX_X、X_XXX 这类断点棋形。
     * 搜索叶子如果只看连续棋，会和 move ordering 的窗口启发不一致。
     * 这里按全盘滑动窗口补上断点四、跳三、活三等形状，让静态评估
     * 和候选排序使用同一套棋理。
     */
    let mut score = 0;
    for r in 0..SIZE as i16 {
        for c in 0..SIZE as i16 {
            for &(dr, dc) in &DIRS {
                score += score_existing_window(board, side, r, c, dr, dc);
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
    while board.has_stone(nr, nc, side) {
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
        board.is_empty_point(ar, ac)
    };
    let open_b = board.is_empty_point(nr, nc);
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
    while board.has_stone(r, c, side) {
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
    board.is_empty_point(r, c) && side != 0
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

fn score_window(board: &Board, mv: Move, side: i8, sr: i16, sc: i16, dr: i16, dc: i16) -> i32 {
    let mut line = [0_i8; 5];
    for step in 0..5 {
        let r = sr + dr * step;
        let c = sc + dc * step;
        if !in_board(r, c) {
            return 0;
        }
        let is_candidate = r == mv.r as i16 && c == mv.c as i16;
        if !is_candidate && board.has_stone(r, c, -side) {
            return 0;
        }
        if is_candidate || board.has_stone(r, c, side) {
            line[step as usize] = 1;
        } else {
            line[step as usize] = 0;
        }
    }

    let before_open = board.is_empty_point(sr - dr, sc - dc);
    let after_open = board.is_empty_point(sr + dr * 5, sc + dc * 5);
    classify_window(&line, before_open, after_open)
}

fn score_existing_window(board: &Board, side: i8, sr: i16, sc: i16, dr: i16, dc: i16) -> i32 {
    /*
     * 评估当前局面中已经存在的五格窗口。
     *
     * 和 score_window 的区别是这里没有候选落子；窗口内如果有对手棋，
     * 这条窗口对 side 当前没有直接威胁价值。
     */
    let mut line = [0_i8; 5];
    for step in 0..5 {
        let r = sr + dr * step;
        let c = sc + dc * step;
        if !in_board(r, c) {
            return 0;
        }
        if board.has_stone(r, c, -side) {
            return 0;
        }
        if board.has_stone(r, c, side) {
            line[step as usize] = 1;
        }
    }

    let before_open = board.is_empty_point(sr - dr, sc - dc);
    let after_open = board.is_empty_point(sr + dr * 5, sc + dc * 5);
    classify_window(&line, before_open, after_open) / 2
}

fn classify_window(line: &[i8; 5], before_open: bool, after_open: bool) -> i32 {
    /*
     * 五格窗口分类。
     *
     * 这里不能只看 stones/empty/open 数量，否则 XX_XX 会被误当成
     * _XXXX_ 这种真活四，X_X_X 也会被误当成真活三。
     */
    let stones = line.iter().filter(|&&v| v == 1).count() as i32;
    let empty = 5 - stones;
    if stones == 5 {
        return 50_000_000;
    }

    if stones == 4 && empty == 1 {
        let empty_idx = line.iter().position(|&v| v == 0).unwrap_or(0);
        let true_open_four = (empty_idx == 0 && after_open) || (empty_idx == 4 && before_open);
        return if true_open_four {
            12_000_000
        } else {
            8_000_000
        };
    }

    if stones == 3 && empty == 2 {
        if has_true_open_three(line, before_open, after_open) {
            return 1_500_000;
        }
        if has_jump_three(line, before_open, after_open) {
            return 450_000;
        }
    }

    if stones == 2 && empty == 3 && has_open_two(line, before_open, after_open) {
        return 45_000;
    }

    0
}

fn has_true_open_three(line: &[i8; 5], before_open: bool, after_open: bool) -> bool {
    /*
     * 真活三要求存在连续三子，并且这组三子的两侧都是空点。
     * 例如 _XXX_、边界外侧为空的 XXX__ / __XXX 也能形成活三含义。
     */
    for start in 0..=2 {
        if line[start] == 1 && line[start + 1] == 1 && line[start + 2] == 1 {
            let left_open = if start == 0 {
                before_open
            } else {
                line[start - 1] == 0
            };
            let right_open = if start + 2 == 4 {
                after_open
            } else {
                line[start + 3] == 0
            };
            if left_open && right_open {
                return true;
            }
        }
    }
    false
}

fn has_jump_three(line: &[i8; 5], before_open: bool, after_open: bool) -> bool {
    /*
     * 跳三/眠三有进攻价值，但不能按真活三处理。
     * 至少要求窗口两侧或内部仍有延展空间，否则只是普通散形。
     */
    let open_slots =
        line.iter().filter(|&&v| v == 0).count() as i32 + before_open as i32 + after_open as i32;
    open_slots >= 3
}

fn has_open_two(line: &[i8; 5], before_open: bool, after_open: bool) -> bool {
    /*
     * 活二只作为很弱的形状信号。要求至少有一个连续二，并且两侧有空间。
     */
    for start in 0..=3 {
        if line[start] == 1 && line[start + 1] == 1 {
            let left_open = if start == 0 {
                before_open
            } else {
                line[start - 1] == 0
            };
            let right_open = if start + 1 == 4 {
                after_open
            } else {
                line[start + 2] == 0
            };
            if left_open && right_open {
                return true;
            }
        }
    }
    false
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
