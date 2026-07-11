//! 公共类型。

use serde::Serialize;

pub const SIZE: usize = 15;
pub const EMPTY: i8 = 0;
pub const BLACK: i8 = 1;
pub const WHITE: i8 = -1;
pub const INF: i32 = 1_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Move {
    pub r: u8,
    pub c: u8,
}

#[derive(Clone, Debug, Serialize)]
pub struct HeatPoint {
    pub r: u8,
    pub c: u8,
    pub score: i32,
}

#[derive(Clone, Debug, Serialize)]
pub struct SearchOutput {
    pub r: i16,
    pub c: i16,
    pub score: i32,
    pub depth: u8,
    pub nodes: u64,
    #[serde(rename = "timeMs")]
    pub time_ms: u64,
    pub nps: u64,
    pub heatmap: Vec<HeatPoint>,
}
