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
    // 坐标评估仍然频繁读取单点状态，数组能让 evaluate.rs 简洁直接。
    cells: [i8; SIZE * SIZE],
    // 225 位拆成 4 个 u64。第 idx 位表示 r * 15 + c 是否有该方棋子。
    black_bits: [u64; 4],
    white_bits: [u64; 4],
    // 用计数判断空棋盘/满棋盘，避免每次扫描 225 个点。
    occupied: usize,
}

impl Board {
    /// 从 JS 传入的一维数组构造棋盘。
    ///
    /// 这里同时填充数组和 Bitboard，保证后续评估与胜负判断读到同一份状态。
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

    pub fn place(&mut self, mv: Move, side: i8) {
        // 搜索会频繁 clone 后 place，因此这里必须同时更新数组和 bit mask。
        self.set_at(mv.r as usize * SIZE + mv.c as usize, side);
    }

    pub fn is_empty(&self) -> bool {
        self.occupied == 0
    }

    pub fn is_full(&self) -> bool {
        self.occupied == SIZE * SIZE
    }

    pub fn has_five(&self, _mv: Move, side: i8) -> bool {
        /*
         * Bitboard 五连判断。
         *
         * stride 对应一维数组上的方向：
         * - 1：横向；
         * - 15：纵向；
         * - 16：左上到右下；
         * - 14：右上到左下。
         *
         * mask 限制合法起点，防止横向跨行或斜向越界造成假五连。
         */
        let bits = self.bits_for(side);
        has_run(bits, 1, H_MASK)
            || has_run(bits, 15, V_MASK)
            || has_run(bits, 16, D1_MASK)
            || has_run(bits, 14, D2_MASK)
    }

    /// 判断 side 如果下在 mv 是否立即五连。
    ///
    /// 这个函数不 clone 棋盘，也不修改数组，只在该方 Bitboard 的拷贝上临时置位。
    /// 候选排序会大量调用它，比 clone + place + has_five 更适合热路径。
    pub fn would_win(&self, mv: Move, side: i8) -> bool {
        let mut bits = self.bits_for(side);
        let idx = mv.r as usize * SIZE + mv.c as usize;
        bits[idx / 64] |= 1_u64 << (idx % 64);
        has_run(bits, 1, H_MASK)
            || has_run(bits, 15, V_MASK)
            || has_run(bits, 16, D1_MASK)
            || has_run(bits, 14, D2_MASK)
    }

    pub fn cells(&self) -> &[i8; SIZE * SIZE] {
        &self.cells
    }

    /// 判断某个坐标是否属于指定方。
    ///
    /// 评估函数的热路径会大量查询“这个点是不是某方棋子”。
    /// 这里直接查 Bitboard，避免每次都回到 `cells` 数组。
    pub fn has_stone(&self, r: i16, c: i16, side: i8) -> bool {
        if !in_board(r, c) {
            return false;
        }
        let idx = r as usize * SIZE + c as usize;
        let bits = self.bits_for(side);
        (bits[idx / 64] & (1_u64 << (idx % 64))) != 0
    }

    /// 判断某个坐标是否为空。
    ///
    /// 空点等价于黑白双方 Bitboard 对应位都为 0。
    pub fn is_empty_point(&self, r: i16, c: i16) -> bool {
        if !in_board(r, c) {
            return false;
        }
        let idx = r as usize * SIZE + c as usize;
        let bit = 1_u64 << (idx % 64);
        (self.black_bits[idx / 64] & bit) == 0 && (self.white_bits[idx / 64] & bit) == 0
    }

    /// 返回指定方 Bitboard。
    ///
    /// 静态评估会遍历同色棋子的置位点，避免逐格扫描 225 个数组元素。
    pub fn bit_words(&self, side: i8) -> [u64; 4] {
        self.bits_for(side)
    }

    /// 返回黑白双方 Bitboard。
    ///
    /// 置换表哈希只需要位集合，不需要扫描 225 个数组格子。
    pub fn bitboards(&self) -> ([u64; 4], [u64; 4]) {
        (self.black_bits, self.white_bits)
    }

    fn set_at(&mut self, idx: usize, side: i8) {
        /*
         * 设置单点状态。
         *
         * 即使目前只会从空位落子，这里也先清掉黑白双方对应 bit，
         * 防止未来调试或扩展撤销/覆盖时留下脏 bit。
         */
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
        // 返回拷贝是有意的：[u64; 4] 很小，便于后续 shift-and 直接按值计算。
        if side == BLACK {
            self.black_bits
        } else {
            self.white_bits
        }
    }
}

pub fn in_board(r: i16, c: i16) -> bool {
    // 统一边界判断，避免评估和候选生成里写出不一致的 15x15 条件。
    (0..SIZE as i16).contains(&r) && (0..SIZE as i16).contains(&c)
}

fn has_run(bits: [u64; 4], stride: usize, mask: [u64; 4]) -> bool {
    /*
     * 检查某个方向是否存在连续五个 1。
     *
     * 核心等式：
     * bits & (bits >> stride) & ... & (bits >> stride*4)
     * 如果某个起点仍为 1，就说明起点及后面四个方向点都被占用。
     */
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
    /*
     * 对 4 个 u64 组成的 256 位小端 bitset 做整体右移。
     *
     * idx 越大表示棋盘越靠后的点；右移 stride 后，原本 idx+stride 的点
     * 会对齐到 idx，方便 has_run 做按位与。
     */
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
    /*
     * 编译期生成某个方向的合法五连起点 mask。
     *
     * 例如横向 (0,1) 只允许 c <= 10 的点作为起点；
     * 右上到左下 (1,-1) 只允许 c >= 4 的点作为起点。
     */
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
