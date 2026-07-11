//! 公共类型。
//!
//! 这些结构会被 Rust 搜索模块和 serde JSON 输出共同使用。
//! 字段命名尽量保持短小，减少 Worker 间传输和前端表格处理的心智负担。

use serde::Serialize;

pub const SIZE: usize = 15;
pub const EMPTY: i8 = 0;
pub const BLACK: i8 = 1;
pub const WHITE: i8 = -1;
pub const INF: i32 = 1_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Move {
    /// 行坐标，范围 0..14。
    pub r: u8,
    /// 列坐标，范围 0..14。
    pub c: u8,
}

#[derive(Clone, Debug, Serialize)]
pub struct HeatPoint {
    /// 候选点行坐标。
    pub r: u8,
    /// 候选点列坐标。
    pub c: u8,
    /// Rust 引擎给该候选点的搜索或静态评分。
    pub score: i32,
}

#[derive(Clone, Debug, Serialize)]
pub struct SearchOutput {
    /// 最佳落子行；-1 表示没有可下点。
    pub r: i16,
    /// 最佳落子列；-1 表示没有可下点。
    pub c: i16,
    /// 最佳落子的 Minimax 分数。
    pub score: i32,
    /// 本次搜索完成的最大迭代深度。
    pub depth: u8,
    /// 搜索访问的节点数。
    pub nodes: u64,
    /// 搜索耗时，前端字段名保持 timeMs。
    #[serde(rename = "timeMs")]
    pub time_ms: u64,
    /// 每秒节点数，用于观察性能。
    pub nps: u64,
    /// 候选点评分，用于前端红黄绿热力图。
    pub heatmap: Vec<HeatPoint>,
}
