//! 棋盘表示和胜负判断。
//!
//! 15x15 共 225 个点，单个 `u64` 放不下，所以黑白双方各用 4 个 `u64`
//! 保存 Bitboard。数组副本用于评估函数快速按坐标读取，Bitboard 用于
//! 空棋盘、满棋盘和后续高频掩码优化。

use crate::types::{Move, BLACK, EMPTY, SIZE, WHITE};

#[derive(Clone)]
pub struct Board {
    cells: [i8; SIZE * SIZE],
    black_bits: [u64; 4],
    white_bits: [u64; 4],
    occupied: usize,
}

impl Board {
    pub fn from_cells(input: &[i8]) -> Self {
        let mut board = Self {
            cells: [EMPTY; SIZE * SIZE],
            black_bits: [0; 4],
            white_bits: [0; 4],
            occupied: 0,
        };
        for (i, value) in input.iter().take(SIZE * SIZE).enumerate() {
            let side = match *value {
                BLACK => BLACK,
                WHITE => WHITE,
                _ => EMPTY,
            };
            if side != EMPTY {
                board.set_at(i, side);
            }
        }
        board
    }

    pub fn get(&self, r: i16, c: i16) -> i8 {
        if !in_board(r, c) {
            return EMPTY;
        }
        self.cells[r as usize * SIZE + c as usize]
    }

    pub fn place(&mut self, mv: Move, side: i8) {
        self.set_at(mv.r as usize * SIZE + mv.c as usize, side);
    }

    pub fn is_empty(&self) -> bool {
        self.occupied == 0
    }

    pub fn is_full(&self) -> bool {
        self.occupied == SIZE * SIZE
    }

    pub fn has_five(&self, mv: Move, side: i8) -> bool {
        let dirs = [(1, 0), (0, 1), (1, 1), (1, -1)];
        dirs.iter().any(|&(dr, dc)| {
            1 + self.count_dir(mv, side, dr, dc) + self.count_dir(mv, side, -dr, -dc) >= 5
        })
    }

    pub fn cells(&self) -> &[i8; SIZE * SIZE] {
        &self.cells
    }

    fn count_dir(&self, mv: Move, side: i8, dr: i16, dc: i16) -> i32 {
        let mut total = 0;
        let mut r = mv.r as i16 + dr;
        let mut c = mv.c as i16 + dc;
        while in_board(r, c) && self.get(r, c) == side {
            total += 1;
            r += dr;
            c += dc;
        }
        total
    }

    fn set_at(&mut self, idx: usize, side: i8) {
        if self.cells[idx] == EMPTY {
            self.occupied += 1;
        }
        let bucket = idx / 64;
        let bit = 1_u64 << (idx % 64);
        self.black_bits[bucket] &= !bit;
        self.white_bits[bucket] &= !bit;
        self.cells[idx] = side;
        match side {
            BLACK => self.black_bits[bucket] |= bit,
            WHITE => self.white_bits[bucket] |= bit,
            _ => {}
        }
    }
}

pub fn in_board(r: i16, c: i16) -> bool {
    (0..SIZE as i16).contains(&r) && (0..SIZE as i16).contains(&c)
}
