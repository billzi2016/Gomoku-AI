//! 棋盘表示和胜负判断。
//!
//! 15x15 共 225 个点，单个 `u64` 放不下，所以黑白双方各用 4 个 `u64`
//! 保存 Bitboard。数组副本用于评估函数快速按坐标读取，胜负判断使用
//! Bitboard shift-and，避免这里变成“只有名字是 Bitboard”的实现。

use crate::types::{Move, BLACK, EMPTY, SIZE, WHITE};

const H_MASK: [u64; 4] = build_start_mask(0, 1);
const V_MASK: [u64; 4] = build_start_mask(1, 0);
const D1_MASK: [u64; 4] = build_start_mask(1, 1);
const D2_MASK: [u64; 4] = build_start_mask(1, -1);

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

    pub fn has_five(&self, _mv: Move, side: i8) -> bool {
        let bits = self.bits_for(side);
        has_run(bits, 1, H_MASK)
            || has_run(bits, 15, V_MASK)
            || has_run(bits, 16, D1_MASK)
            || has_run(bits, 14, D2_MASK)
    }

    pub fn cells(&self) -> &[i8; SIZE * SIZE] {
        &self.cells
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

    fn bits_for(&self, side: i8) -> [u64; 4] {
        if side == BLACK {
            self.black_bits
        } else {
            self.white_bits
        }
    }
}

pub fn in_board(r: i16, c: i16) -> bool {
    (0..SIZE as i16).contains(&r) && (0..SIZE as i16).contains(&c)
}

fn has_run(bits: [u64; 4], stride: usize, mask: [u64; 4]) -> bool {
    let s1 = shift_right(bits, stride);
    let s2 = shift_right(bits, stride * 2);
    let s3 = shift_right(bits, stride * 3);
    let s4 = shift_right(bits, stride * 4);
    let mut i = 0;
    while i < 4 {
        if (bits[i] & s1[i] & s2[i] & s3[i] & s4[i] & mask[i]) != 0 {
            return true;
        }
        i += 1;
    }
    false
}

fn shift_right(bits: [u64; 4], shift: usize) -> [u64; 4] {
    let word_shift = shift / 64;
    let bit_shift = shift % 64;
    let mut out = [0_u64; 4];
    let mut i = 0;
    while i < 4 {
        let src = i + word_shift;
        if src < 4 {
            out[i] |= bits[src] >> bit_shift;
            if bit_shift != 0 && src + 1 < 4 {
                out[i] |= bits[src + 1] << (64 - bit_shift);
            }
        }
        i += 1;
    }
    out
}

const fn build_start_mask(dr: i16, dc: i16) -> [u64; 4] {
    let mut mask = [0_u64; 4];
    let mut r = 0_i16;
    while r < SIZE as i16 {
        let mut c = 0_i16;
        while c < SIZE as i16 {
            let er = r + dr * 4;
            let ec = c + dc * 4;
            if er >= 0 && er < SIZE as i16 && ec >= 0 && ec < SIZE as i16 {
                let idx = (r as usize) * SIZE + c as usize;
                mask[idx / 64] |= 1_u64 << (idx % 64);
            }
            c += 1;
        }
        r += 1;
    }
    mask
}
