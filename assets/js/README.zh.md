# JavaScript 前端和 Worker 层

这个目录放浏览器侧代码。它不实现搜索引擎。它负责绘制棋盘、管理游戏模式、接收用户点击、把 AI 搜索任务分给 Web Worker，并展示 Rust/Wasm 返回的搜索结果。

## 文件

```text
main.js       # 启动页面并创建 GomokuGame
game.js       # 游戏模式、回合、胜负检查、状态文字和落子表
board-ui.js   # Canvas 棋盘、棋子、星位、热力图和点击坐标转换
ai-manager.js # Worker 池和根候选分片
ai-worker.js  # 加载 Wasm 模块并调用 search_best_move()
```

## 每个文件做什么

`main.js` 是页面入口。它等待 `DOMContentLoaded`，找到棋盘 canvas，创建 `GomokuGame`，并把初始化错误显示在页面底部状态栏。

`game.js` 保存游戏状态。棋盘是 225 项 `Int8Array`；黑棋是 `1`，白棋是 `-1`，空点是 `0`。它支持人机、人人和机机模式。人机模式固定人类黑棋，AI 白棋。

`board-ui.js` 用 canvas 绘制棋盘。它把鼠标坐标转换成 15x15 交叉点，绘制棋子和星位，并展示 AI 热力图。热力图输入是 Rust 返回的 `{ r, c, score }` 数组。

`ai-manager.js` 管理 Worker 池。它按浏览器报告的 CPU 线程数创建约 90% 数量的 Worker，先请求 Rust 生成根候选，再把候选点分片给 Worker 并合并结果。

`ai-worker.js` 运行在 Worker 线程里。它加载 `assets/wasm/gomoku_ai.js`，等待 Wasm 初始化，调用 `search_best_move()`，解析 JSON 结果，再发回 manager。

## 输入和输出

前端通过 Worker 发送给 Rust 的输入是：

```text
cells: Int8Array(225)       # 15x15 棋盘，索引 row * 15 + col
isBlackTurn: boolean        # true 表示黑棋搜索，false 表示白棋搜索
thinkTimeMs: number         # 通常是 5000
legalMoves: Uint8Array      # 可选根节点分片，编码为 r * 15 + c
```

Rust 返回 JSON：

```text
r, c        # 选中的落子；-1/-1 表示没有可下点
score       # 该落子的 Minimax 分数
depth       # 完成的搜索深度
nodes       # 访问节点数
timeMs      # 耗时，单位毫秒
nps         # 每秒节点数
heatmap     # 候选点评分，用于棋盘热力图
```

## 怎么判断运行正常

AI 搜索时棋盘不应该卡死。状态栏会显示 AI 正在思考。AI 落子后，右侧面板应新增一行，包含深度、节点数、NPS、耗时和分数。棋盘上的空候选点会显示热力图，绿色表示评分更高。

如果页面提示 AI 引擎初始化失败，请通过 `python3 server.py` 打开项目，不要用 `file://`。Worker 和 Wasm 在本地文件 URL 下不可靠。

## 为什么需要 Worker 层

Rust/Wasm 很快，但如果搜索直接跑在浏览器主线程，页面输入和绘制会卡住。Worker 让 UI 线程保持空闲。manager 还会把根候选分给多个 Worker，让引擎使用多个 CPU 核心。
