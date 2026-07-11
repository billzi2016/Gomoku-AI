# GOMOKU AI 文档

这个文档站说明浏览器游戏、JavaScript Worker 层和 Rust/Wasm 引擎如何配合。

项目 README 用于了解整体。规格说明用于确认规则、数据流和预期行为。JavaScript 与 Rust 页面用于修改对应代码前阅读。

## 这个项目做什么

GOMOKU AI 在浏览器中运行自由五子棋。GitHub Pages 只提供静态文件。访问者的浏览器提供 CPU。AI 引擎由 Rust 编译成 WebAssembly，Web Worker 负责让搜索过程不阻塞页面。

## 怎么阅读这些文档

- 想了解整体，先看项目 README。
- 想确认怎么下棋、freestyle 和 Renju 禁手差别，看玩法说明。
- 需要确认规则、输入输出和正常结果，看规格说明。
- 修改 UI、Worker 分发或热力图前，看 JavaScript 层。
- 修改搜索、评估、Bitboard 或性能前，看 Rust 引擎。

## 生成开局库

网页实战保持每步 5 秒搜索预算。开局库是离线生成的，可以给每个局面 15 秒搜索时间。

```bash
THINK_MS=15000 MAX_ENTRIES=500 MAX_PLY=8 RADIUS=4 BRANCH=8 WORKERS=22 ./tools/opening-book/generate-opening-book.sh
```

输出文件是 `assets/opening-book/opening-book.json`。生成器复用浏览器 AI 的根节点分片逻辑，只把离线预算调长。条目使用对称和平移归一化，避免保存重复局面。

## 文档站链接

发布后，文档站地址是：

```text
https://billzi2016.github.io/Gomoku-AI/docs/
```
