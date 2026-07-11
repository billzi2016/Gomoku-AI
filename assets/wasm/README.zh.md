# 生成的 Wasm 绑定

这个目录放从 Rust 引擎生成的浏览器可加载文件。这些文件是构建产物，但需要提交到仓库中，因为 GitHub Pages 只提供静态文件，游戏不能依赖后端服务。

## 文件

```text
gomoku_ai.js              # wasm-bindgen 生成的 JavaScript glue，由 Worker 加载
gomoku_ai_bg.wasm         # 编译后的 Rust/Wasm 引擎
gomoku_ai.d.ts            # JS glue 的 TypeScript 声明
gomoku_ai_bg.wasm.d.ts    # Wasm 模块的 TypeScript 声明
```

## 这些文件做什么

`gomoku_ai_bg.wasm` 包含编译后的 Rust 搜索引擎。它负责棋盘解析、Bitboard 胜负判断、候选生成、评估、NegaMax 搜索、Alpha-Beta 剪枝和 JSON 结果编码。

`gomoku_ai.js` 由 `wasm-bindgen` 生成。它加载 `.wasm` 文件，处理 JavaScript 到 Wasm 的值转换，并导出 Rust 函数 `search_best_move()`。

`.d.ts` 文件给编辑器和 TypeScript 工具提供类型信息。浏览器运行游戏时不需要 TypeScript。

## 为什么不要手工改这些文件

真正的源码在 `rust-ai/src/`。手工修改生成的 Wasm 文件，下次构建时会被覆盖。如果要改变 AI 行为，应该修改 Rust，重新构建，再提交新的生成文件。

## 构建命令

在 `rust-ai/` 目录运行：

```bash
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir ../assets/wasm --out-name gomoku_ai target/wasm32-unknown-unknown/release/gomoku_ai.wasm
```

## 运行时输入和输出

`ai-worker.js` 会导入 `gomoku_ai.js` 并调用：

```text
search_best_move(cells, isBlackTurn, thinkTimeMs, legalMoves)
```

输入：

```text
cells        # Int8Array 兼容棋盘值：1 黑棋，-1 白棋，0 空点
isBlackTurn  # true 表示黑棋，false 表示白棋
thinkTimeMs  # 搜索时间预算
legalMoves   # 可选根节点分片，编码为 row * 15 + col
```

输出：

```text
JSON 字符串，包含 r、c、score、depth、nodes、timeMs、nps 和 heatmap
```

## 怎么判断正常

浏览器应该能在 Worker 中加载 `assets/wasm/gomoku_ai.js`。一次成功的 AI 落子应返回棋盘坐标和非零搜索统计。如果 Worker 报告 Wasm 未初始化，请检查页面是否通过 HTTP 打开，并确认 `gomoku_ai.js` 和 `gomoku_ai_bg.wasm` 都存在。
