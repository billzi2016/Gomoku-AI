# Rust/Wasm 引擎

这个目录放五子棋 AI 引擎。它会编译成 WebAssembly，并由浏览器 Worker 调用。JavaScript 层负责 UI 和并行任务分发；Rust 负责候选生成、局面评估、Bitboard 胜负判断、VCF 连续冲四算杀、反杀防御检查和 NegaMax 搜索。

## 文件

```text
Cargo.toml      # Rust crate 元信息和 wasm-bindgen 依赖
src/lib.rs      # wasm-bindgen 导出函数 search_best_move()
src/types.rs    # 序列化为 JSON 的共享数据结构
src/board.rs    # 棋盘存储、Bitboard 和五连判断
src/movegen.rs  # 候选生成和缓存后的排序分
src/evaluate.rs # 静态评估和威胁评分
src/threat.rs   # VCF 连续冲四算杀
src/search.rs   # 迭代加深、NegaMax、Alpha-Beta、置换表
```

## 输入和输出

导出函数是：

```rust
search_best_move(cells, is_black_turn, think_time_ms, allowed_moves) -> String
```

输入：

```text
cells           # 225 个棋盘值：黑棋 1，白棋 -1，空点 0
is_black_turn   # true 表示黑棋搜索，false 表示白棋搜索
think_time_ms   # 当前 Worker 的思考时间预算
allowed_moves   # 可选根节点，编码为 r * 15 + c
```

输出是 JSON 字符串，因为它跨 Wasm 边界简单稳定：

```text
r, c, score, depth, nodes, timeMs, nps, heatmap
```

## 棋盘模型

引擎保留同一个局面的两种视图。

`cells` 是 225 项数组，方便写坐标评估逻辑。

`black_bits` 和 `white_bits` 分别是四个 `u64`。15x15 棋盘有 225 个点，一个 `u64` 放不下。位索引 `row * 15 + col` 对应一个棋盘点。

胜负判断使用 Bitboard shift-and。横向五连用 stride `1`，纵向用 `15`，两个斜向用 `16` 和 `14`。每个方向都有 mask 限制合法起点，防止位移跨行造成假五连。

## 搜索

搜索使用 NegaMax，它是 Minimax 的对称写法。它假设当前行动方要最大分，对手也会选择强落子。回合切换时，递归结果取负。

Alpha-Beta 剪枝会跳过不可能改变当前决策的分支。它依赖好的排序：强落子越早搜索，剪枝越有效。

迭代加深从深度 1 开始，再搜深度 2，直到时间到或达到最大深度。时间到时，引擎返回上一层完整搜索得到的最佳落子。

置换表在一次搜索内缓存局面。key 来自黑白 Bitboard 和当前行动方。

## VCF 连续冲四算杀

`src/threat.rs` 负责 VCF。VCF 的意思是 Victory by Continuous Four，也就是一方连续制造“对手下一手必须堵”的四，直到出现无法全部防住的五连点。

这个模块不替代 NegaMax。它只在根候选上做确定性检查：

```text
自己立即五连
堵住对手立即五连
自己落子后是否进入 VCF 强制胜
自己落子后是否让对手进入立即胜或 VCF 强制胜
```

如果 VCF 能证明一条强制胜线，引擎会优先走；如果证明不了，就回到普通搜索。这样可以提高进攻性，同时避免把普通活三误判成必胜。

为了避免被偷家，VCF 会同时检查对手。一个候选点如果看起来进攻很强，但下完后对手存在立即五连或连续冲四胜，这个候选会被压成大负分，交给其他安全候选竞争。

## 威胁评分

五子棋需要直接处理战术威胁。评估器会识别：

- 自己一步成五，
- 对手一步成五需要堵，
- 四连，
- `XX_XX`、`XXX_X`、`X_XXX` 这类断点四，
- 可能进入连续逼迫的活三。

引擎不会让防守绝对压过一切。立即失败和强四仍然必须防，但 AI 自己的强制进攻会高于对手普通威胁。这样可以避免引擎在整盘棋里只被动补防，明明能抢先手却不进攻。

当前落子排序大致是：

```text
自己立即胜
堵对手立即胜
制造自己的强制四或断点四
防守对手强制四或断点四
制造自己的活三
防守对手活三
普通进攻和防守棋形分
```

## 性能说明

引擎不会在排序比较函数里生成子局面。候选点分数只计算一次，然后保存在 `ScoredMove` 里。

立即胜判断使用 `would_win()` 临时设置 Bitboard，不 clone 整个棋盘。

递归超时检查按节点数采样。Wasm 调 `Date.now()` 需要跨到 JavaScript，如果每个节点都调用，会浪费搜索时间。

## 构建

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir ../assets/wasm --out-name gomoku_ai target/wasm32-unknown-unknown/release/gomoku_ai.wasm
```

浏览器加载 `../assets/wasm/gomoku_ai.js`。

## 怎么判断正常

空棋盘时，候选生成应该优先天元。如果对手已经有开放四连，引擎应该返回堵点。搜索输出应该包含非零节点数、完成深度、耗时和热力图。
