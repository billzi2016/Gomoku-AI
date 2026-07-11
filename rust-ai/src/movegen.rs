//! 候选点生成。
//!
//! 五子棋所有空位都合法，但搜索不能遍历全部 225 个点。
//! 这里只取已有棋子附近两格内的空点，并一次性计算排序分。
//! 注意：排序比较函数只比较缓存好的分数，不在 comparator 中生成子局面。

use crate::board::{in_board, Board};
use crate::evaluate::quick_move_score;
use crate::types::{Move, EMPTY, SIZE};

#[derive(Clone, Copy)]
pub struct ScoredMove {
    pub mv: Move,
    pub order_score: i32,
}

pub fn generate_candidates(board: &Board, side: i8, limit: usize) -> Vec<ScoredMove> {
    if board.is_empty() {
        return vec![ScoredMove {
            mv: Move { r: 7, c: 7 },
            order_score: 1_000_000,
        }];
    }

    let mut seen = [false; SIZE * SIZE];
    let mut out = Vec::new();
    for r in 0..SIZE {
        for c in 0..SIZE {
            if board.cells()[r * SIZE + c] == EMPTY {
                continue;
            }
            for dr in -2..=2 {
                for dc in -2..=2 {
                    if dr == 0 && dc == 0 {
                        continue;
                    }
                    let nr = r as i16 + dr;
                    let nc = c as i16 + dc;
                    if !in_board(nr, nc) {
                        continue;
                    }
                    let idx = nr as usize * SIZE + nc as usize;
                    if seen[idx] || board.cells()[idx] != EMPTY {
                        continue;
                    }
                    seen[idx] = true;
                    let mv = Move { r: nr as u8, c: nc as u8 };
                    out.push(ScoredMove {
                        mv,
                        order_score: quick_move_score(board, mv, side),
                    });
                }
            }
        }
    }

    out.sort_by(|a, b| b.order_score.cmp(&a.order_score));
    out.truncate(limit);
    out
}
