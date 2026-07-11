# 五子棋 AI

这是一个可以部署到 GitHub Pages 的纯前端五子棋 AI。人类执黑先手，AI 执白后手，规则为自由五子棋，没有禁手。

## 功能

- Rust/Wasm 负责高计算量 AI 引擎。
- 使用 Bitboard 思路压缩棋盘状态，并只生成棋子附近的候选点。
- 使用 NegaMax Minimax、Alpha-Beta 剪枝、迭代加深和置换表。
- Web Worker 池默认使用约 90% 的本机 CPU 线程。
- AI 每步最多思考 5 秒，超时立即返回当前最优落子。
- 棋盘显示候选热力图：绿色更强，黄色居中，红色较低。
- 右侧评分表显示搜索深度、节点数、NPS、耗时和 Minimax 分数。
- `coi-serviceworker.js` 为 GitHub Pages 补 COOP/COEP 响应头。

## 构建

先安装 Rust、Wasm target 和 wasm-bindgen：

```bash
rustup default stable
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
```

构建引擎：

```bash
cd rust-ai
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir ../assets/wasm --out-name gomoku_ai target/wasm32-unknown-unknown/release/gomoku_ai.wasm
```

## 本地预览

```bash
python3 server.py
```

服务器会自动选择一个随机可用端口，并打印本地访问链接。

## 部署

GitHub Actions 会自动编译 Rust/Wasm，并把静态文件上传到 GitHub Pages。

## 架构说明

当前 AI 没有使用 Wasm pthread。它使用多个浏览器 Web Worker，每个 Worker 加载同一个 Rust/Wasm 模块，并搜索一部分根候选落子。Service Worker 仍然保留，用来开启跨源隔离响应头，也方便后续接入更严格的浏览器能力。
