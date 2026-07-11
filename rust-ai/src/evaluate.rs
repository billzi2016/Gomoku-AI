//! 局面评估。
//!
//! 本模块只做静态评分和单点快速预估，不生成子局面。
//! 搜索排序会先缓存 `quick_move_score` 的结果，避免在排序比较中重复递归或分配。

use crate::board::{in_board, Board};
use crate::types::{Move, EMPTY};

const DIRS: [(i16, i16); 4] = [(1, 0), (0, 1), (1, 1), (1, -1)];

/// 返回 root 方视角的静态分数。
pub fn evaluate(board: &Board, root_side: i8) -> i32 {
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
    if winning_move(board, mv, side) {
        return 40_000_000;
    }
    if winning_move(board, mv, -side) {
        return 35_000_000;
    }
    let attack = local_shape_score(board, mv, side);
    let defend = local_shape_score(board, mv, -side);
    center_bonus(mv) + attack * 3 + defend * 5
}

/// 根节点战术分。
///
/// 根节点必须优先处理确定性战术：自己能五连就直接赢，
/// 对手下一手能五连就必须堵。这个函数只检查当前候选点，不生成候选列表。
pub fn root_tactical_score(board: &Board, mv: Move, side: i8) -> Option<i32> {
    if winning_move(board, mv, side) {
        return Some(500_000_000);
    }
    if winning_move(board, mv, -side) {
        return Some(450_000_000);
    }
    None
}

fn score_side(board: &Board, side: i8) -> i32 {
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
    let r = mv.r as i16 + dr * (stones as i16 + 1);
    let c = mv.c as i16 + dc * (stones as i16 + 1);
    in_board(r, c) && board.get(r, c) == EMPTY && side != 0
}

fn pattern_score(len: i32, open: i32) -> i32 {
    match (len, open) {
        (5.., _) => 20_000_000,
        (4, 2) => 2_000_000,
        (4, 1) => 250_000,
        (3, 2) => 60_000,
        (3, 1) => 8_000,
        (2, 2) => 2_500,
        (2, 1) => 600,
        (1, 2) => 80,
        _ => 10,
    }
}

fn center_bonus(mv: Move) -> i32 {
    let dr = (mv.r as i32 - 7).abs();
    let dc = (mv.c as i32 - 7).abs();
    120 - (dr + dc) * 8
}

fn winning_move(board: &Board, mv: Move, side: i8) -> bool {
    let mut next = board.clone();
    next.place(mv, side);
    next.has_five(mv, side)
}
