# GOMOKU AI

这是一个完全运行在浏览器里的 Rust/Wasm 五子棋 AI。引擎使用 Bitboard 胜负判断、NegaMax Minimax、Alpha-Beta 剪枝、迭代加深、置换表缓存、威胁感知评估和 Web Worker 根节点并行搜索。规则是自由五子棋：人类黑子先手，AI 白子后手，没有任何禁手。

[English README](https://github.com/billzi2016/Gomoku-AI/blob/main/README.md)

## 在线演示

https://billzi2016.github.io/Gomoku-AI/

## 文档站

https://billzi2016.github.io/Gomoku-AI/docs/

## 功能

- 可部署到 GitHub Pages 的纯前端五子棋。
- 三种模式：人机、人人、机机。
- 人机模式固定人类执黑先手，AI 执白后手。
- 自由五子棋规则：没有禁手，没有 Renju 限制，任何空点都可以下。
- Rust/Wasm 负责高计算量 AI 搜索核心。
- 15x15 棋盘使用 Bitboard 做五连胜负判断。
- NegaMax Minimax 搜索和 Alpha-Beta 剪枝。
- 迭代加深保证 AI 在时间限制内始终有可返回的当前最优解。
- 置换表缓存一次搜索内重复到达的局面。
- 威胁感知排序和评估：识别活三、四连、断点四和立即胜。
- 明确的攻防平衡：必胜和必堵优先，但当 AI 自己的强制进攻大于对手普通威胁时，会主动进攻。
- AI 每步最多思考 5 秒。
- Web Worker 池默认使用约 90% 的本机 CPU 线程。
- 棋盘候选热力图：绿色更强，黄色居中，红色较低。
- 右侧搜索评分表显示深度、分数、节点数、NPS 和耗时。
- `coi-serviceworker.js` 为 GitHub Pages 等静态托管补跨源隔离响应头。

## 项目结构

```text
index.html                  # 页面入口、布局、模式菜单和搜索评分表
coi-serviceworker.js        # 通过 Service Worker 补 COOP/COEP 响应头
assets/css/style.css        # 全局布局、计分、控制区、响应式尺寸
assets/css/board.css        # 棋盘外框、canvas 尺寸和模式覆盖层
assets/js/main.js           # 页面启动入口
assets/js/game.js           # 对局流程、模式、回合、胜负判断和评分表
assets/js/board-ui.js       # Canvas 棋盘、棋子、星位、热力图和点击坐标转换
assets/js/ai-manager.js     # Worker 池和根候选分片
assets/js/ai-worker.js      # 加载 Rust/Wasm 并执行搜索任务
assets/wasm/                # 生成的浏览器 Wasm 绑定
rust-ai/                    # Rust/Wasm AI 引擎
server.py                   # 本地线程化静态服务器，默认随机可用端口
.github/workflows/pages.yml # GitHub Actions 构建和 Pages 部署
```

## 规则

本项目使用自由五子棋：

- 棋盘大小：15x15。
- 黑棋先手。
- 横、竖、斜任意方向五连或更多即胜。
- 没有禁手。
- 长连允许。
- 人机模式中，人类永远是黑棋，AI 永远是白棋。

这意味着 AI 在人机模式里让了人类先手。引擎通过更深搜索、强排序和显式防守来弥补这个劣势。

## 本地开发

不要通过 `file://` 直接打开 `index.html`。Web Worker、Wasm 和 Service Worker 都需要 HTTP 环境。

使用内置服务器：

```bash
python3 server.py
```

也可以手动指定端口：

```bash
python3 server.py --port 9000
```

服务器会打印实际 URL，例如：

```text
http://127.0.0.1:8342/
```

首次访问时，`coi-serviceworker.js` 可能会自动刷新一次页面，让页面进入 Service Worker 控制范围。

## 构建 Rust/Wasm

先安装 Rust 和 `wasm-bindgen-cli`：

```bash
rustup default stable
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
```

构建：

```bash
cd rust-ai
cargo build --target wasm32-unknown-unknown --release
mkdir -p ../assets/wasm
wasm-bindgen --target web --out-dir ../assets/wasm --out-name gomoku_ai target/wasm32-unknown-unknown/release/gomoku_ai.wasm
```

生成文件：

```text
assets/wasm/gomoku_ai.js
assets/wasm/gomoku_ai_bg.wasm
```

`ai-worker.js` 会加载 `assets/wasm/gomoku_ai.js`，并调用 Rust 导出的 `search_best_move()`。

## 生成开局库

网页实战仍然使用每步 5 秒搜索预算。开局库是离线生成的，所以每个关键局面可以使用更慢的 15 秒搜索，不会让玩家等待。

生成紧凑开局库：

```bash
./tools/opening-book/generate-opening-book.sh
```

控制规模：

```bash
THINK_MS=15000 MAX_ENTRIES=500 MAX_PLY=8 RADIUS=4 BRANCH=8 WORKERS=22 ./tools/opening-book/generate-opening-book.sh
```

输出文件：

```text
assets/opening-book/runs/book-t15000-e500-p8-r4-b8-v1.json
assets/opening-book/manifest.json
```

生成器会把结果写到 `assets/opening-book/runs/` 下的参数化文件。同一组参数再次运行会续算同一个文件。不同参数会生成不同文件名，所以 15 秒开局库不会和其他搜索预算或树形参数混在一起。

项目正式开局库默认按 Apple M2 Ultra 24 核 CPU 机器生成。这个本地搜索性能已经不差。除非你确定自己的电脑更强，或者愿意使用更长搜索时间，否则不要重新生成开局库；否则新生成的开局库可能反而更弱。默认运行的耗时估算是：`500 条 * 15 秒 = 7500 秒 = 125 分钟`，也就是约 2 小时 5 分钟纯搜索时间。加上 Worker 调度和写文件，通常约 2 到 2.5 小时。

网页运行时先读取 `assets/opening-book/manifest.json`，再加载 `active` 指向的 run 文件。生成器默认不激活结果。确认质量后，用 `ACTIVATE=1` 更新 manifest：

```bash
ACTIVATE=1 THINK_MS=15000 MAX_ENTRIES=500 MAX_PLY=8 RADIUS=4 BRANCH=8 WORKERS=22 ./tools/opening-book/generate-opening-book.sh
```

生成器复用浏览器 AI 的根节点分片 Worker 搜索路径，只把离线搜索时间调长。它会限制中心区域，使用对称和平移归一化，并输出 `[canonicalKey, canonicalMoveIndex, score]` 形式的紧凑条目。

## AI 设计

引擎使用紧凑的 15x15 棋盘模型：

- `cells`：225 项数组，用于简单坐标评估。
- `black_bits`：四个 `u64`，表示黑棋位置。
- `white_bits`：四个 `u64`，表示白棋位置。

位索引映射：

```text
index = row * 15 + col
```

五连判断使用 Bitboard shift-and：

- stride `1`：横向。
- stride `15`：纵向。
- stride `16`：左上到右下。
- stride `14`：右上到左下。

每个方向都有预计算的合法起点 mask，防止位移后出现跨行假五连。

## 搜索策略

浏览器不会在 UI 线程里跑一个巨大的同步搜索。搜索流程是：

1. JavaScript 先让一个 Worker 请求 Rust 生成根候选和初始热力图。
2. JavaScript 把这些根候选分片给 Worker 池。
3. 每个 Worker 加载同一个 Rust/Wasm 引擎。
4. 每个 Worker 搜索自己分到的根节点。
5. JavaScript 合并最佳结果、总节点数、最大深度、耗时和热力图。

Rust 内部：

- 候选生成只考虑已有棋子附近的空点。
- 每个候选点只计算一次排序分并缓存。
- 排序比较函数只比较缓存分数，不生成子局面。
- NegaMax 递归搜索双方轮流落子。
- Alpha-Beta 剪枝提前砍掉不会改变结果的分支。
- 迭代加深保留上一层完整搜索结果，超时时也能返回稳定落子。
- 置换表在一次搜索内缓存重复局面。
- 超时返回使用当前行动方视角，避免 NegaMax 符号错误。

## 攻防平衡

五子棋 AI 如果只看普通棋形分，很容易因为贪攻漏掉人类的杀棋。本引擎把强制战术和普通压力分开处理：

- AI 自己一步能赢，直接下。
- 人类下一步能赢，AI 必须堵。
- `XX_XX`、`XXX_X`、`X_XXX` 这类断点四会被 5 格窗口识别。
- 活三会被当成高风险威胁，因为它可能进入连续逼迫。
- AI 自己的强制进攻高于对手普通威胁，所以不会满棋盘被动补防。
- 防守分仍然足够高，用来阻止立即失败和强四。
- 中心偏好只是很小的辅助分，不能覆盖紧急战术防守。

这不是宣称“已解”五子棋引擎。它是一个固定 5 秒思考预算内的实用浏览器 AI，目标是稳定击败休闲玩家和大量业余玩家。

## 引擎技术

- **Rust/Wasm**：搜索核心用 Rust 编写并编译为 WebAssembly，所有计算都在访问者本机浏览器中完成。
- **Bitboard**：黑白棋子存储在紧凑的 `u64` 分块里，胜负判断使用位移和 mask。
- **NegaMax Minimax**：假设双方都选择强落子，用对称 NegaMax 简化递归。
- **Alpha-Beta 剪枝**：提前剪掉不可能影响最终决策的分支。
- **迭代加深**：从深度 1 开始逐层加深，时间到时仍能返回当前最佳结果。
- **置换表**：同一搜索内缓存重复局面，减少重复搜索。
- **威胁排序**：立即胜、强制堵、强制进攻、四连、断点四、活三优先搜索。
- **超时采样**：递归中按节点数采样超时，减少 Wasm 调 JS 时间函数的开销。
- **Web Worker 并行**：根节点分片给多个 Worker，默认使用约 90% 可用 CPU 线程。
- **搜索遥测**：每步 AI 落子都会展示深度、Minimax 分数、节点数、NPS 和耗时。

## 热力图

AI 搜索后会在棋盘上覆盖红黄绿热力图：

- 绿色：候选分数更强。
- 黄色：候选分数居中。
- 红色：候选分数较低。
- 只有较高评分点会显示数字，避免棋盘过乱。

热力图不是概率模型。它展示的是引擎搜索和威胁排序后的相对候选分数。

## 为什么保留 `coi-serviceworker.js`

当前 AI 并行模型是多个 Web Worker 分片搜索根节点，每个 Worker 加载自己的 Wasm 模块。它不依赖 Wasm pthread，也不要求 `SharedArrayBuffer`。

保留 `coi-serviceworker.js` 是为了让 GitHub Pages 这类静态托管也能提供跨源隔离响应头，并为未来可能需要 `crossOriginIsolated` 的功能留空间。

普通服务器可以设置：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

GitHub Pages 不能直接配置自定义响应头，所以本项目通过 Service Worker 在客户端补这些头。

## GitHub Pages 部署

仓库包含 GitHub Actions 工作流：

```text
.github/workflows/pages.yml
```

推送到 `main` 后，工作流会：

1. 安装 Rust。
2. 安装 `wasm-bindgen-cli`。
3. 为 `wasm32-unknown-unknown` 构建 `rust-ai`。
4. 在 `assets/wasm/` 生成浏览器可加载文件。
5. 上传静态站点 artifact。
6. 部署到 GitHub Pages。

也可以在 GitHub Actions 页面手动触发。

## 本地构建和手动部署

如果不使用 GitHub Actions，可以用上面的命令本地构建 Rust/Wasm，然后把静态文件发布到 GitHub Pages 分支或 Pages 配置目录。

确保这些文件存在：

```text
index.html
coi-serviceworker.js
assets/css/style.css
assets/css/board.css
assets/js/main.js
assets/js/game.js
assets/js/board-ui.js
assets/js/ai-manager.js
assets/js/ai-worker.js
assets/wasm/gomoku_ai.js
assets/wasm/gomoku_ai_bg.wasm
```

GitHub Pages 只负责提供静态文件。所有 AI 计算都运行在访问者自己的浏览器和 CPU 上。
