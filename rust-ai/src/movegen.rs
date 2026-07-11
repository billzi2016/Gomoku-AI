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
    // 实际落子坐标。
    pub mv: Move,
    // 已缓存的排序分；sort_by 只比较这个数字。
    pub order_score: i32,
}

pub fn generate_candidates(board: &Board, side: i8, limit: usize) -> Vec<ScoredMove> {
    /*
     * 生成候选点。
     *
     * freestyle 五子棋中所有空点都合法，但搜索全棋盘会让分支爆炸。
     * 实战中有意义的点基本都在已有棋子附近，所以只取半径 2 内的空点。
     */
    if board.is_empty() {
        // 空棋盘唯一合理首选是天元。
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
                    // 这里一次性计算排序分，后面的 sort_by 不再触碰棋盘生成逻辑。
                    out.push(ScoredMove {
                        mv,
                        order_score: quick_move_score(board, mv, side),
                    });
                }
            }
        }
    }

    // 只比较缓存分数，避免排序过程中反复 apply/search/生成子局面。
    out.sort_by(|a, b| b.order_score.cmp(&a.order_score));
    out.truncate(limit);
    out
}
