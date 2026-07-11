# 离线开局库生成器

这个目录用于放开局库生成代码。它和浏览器运行时代码分开，避免把长时间搜索、训练参数或批处理脚本混进 `assets/js/`。

目标输出：

```text
assets/opening-book/runs/book-t15000-e500-p8-r4-b8-v1.json
assets/opening-book/manifest.json
```

推荐生成策略：

```text
15x15 freestyle
前 6-10 手
中心 7x7 或 9x9 候选区域
人类黑棋先手，AI 白棋重点优化
每个关键局面用 15s Alpha-Beta / Bitboard 搜索
对称归一化后写入 key -> best move
```

结果文件必须使用紧凑格式：

```text
[canonicalKey, canonicalMoveIndex, score]
```

运行时代码不关心生成器如何得到结果。它先读取 `assets/opening-book/manifest.json`，再加载 `active` 指向的 run 文件。生成器复用 `assets/js/ai-search-core.js`，所以离线搜索和浏览器搜索使用同一套根节点分片与结果合并逻辑。

SGF 导出脚本放在生成数据旁边：

```text
python3 assets/opening-book/json2sgf.py
```

导出器读取 `assets/opening-book/runs/*.json`，写出带缩进的 `assets/opening-book/sgf/*.sgf`。它会根据规范局面的包含关系尽量重建变化树。SGF 用于复查和交换，生成出来的 `.sgf` 是可重复生成的导出产物，不作为默认提交源文件；浏览器运行时继续使用紧凑 JSON，因为加载和匹配更快。

项目正式开局库预期在 Apple M2 Ultra 24 核 CPU 上生成。把这个性能当作基准。除非你的电脑更强，或者你把搜索时间加长到足够弥补性能差距，否则不要重新生成并激活开局库。默认耗时估算：`500 条 * 15 秒 = 7500 秒 = 125 分钟`，约 2 小时 5 分钟纯搜索时间，实际墙钟时间通常约 2 到 2.5 小时。

当前生成命令：

```text
./tools/opening-book/generate-opening-book.sh
```

控制规模：

```text
THINK_MS=15000 MAX_ENTRIES=500 MAX_PLY=8 RADIUS=4 BRANCH=8 WORKERS=22 ./tools/opening-book/generate-opening-book.sh
```

续算和激活：

```text
同一组参数 -> 续算同一个 runs/book-*.json 文件
不同参数 -> 写入另一个 runs/book-*.json 文件
ACTIVATE=1 -> 本轮完成后更新 manifest.json
```

## 如何读日志

示例输出：

```text
opening-book generation thinkMs=15000 workers=22 maxEntries=500 maxPly=8 radius=4 branch=8 run=runs/book-t15000-e500-p8-r4-b8-v1.json activate=no
resumeEntries=0 output=assets/opening-book/runs/book-t15000-e500-p8-r4-b8-v1.json
[start] 1/500 ply-0 ply=0 side=B queue=1 key=B|
[done] 1/500 ply-0 side=B move=7,7 score=1610660 depth=7 nodes=772096 nps=51425 elapsed=15015ms total=15s eta=2h04m queue=1 json~20B
[start] 2/500 ply-1 ply=1 side=W queue=3 key=W|B34
[done] 2/500 ply-1 side=W move=5,7 score=186090 depth=8 nodes=12257280 nps=816010 elapsed=15023ms total=30s eta=2h04m queue=3 json~40B
[start] 3/500 ply-2 ply=2 side=B queue=7 key=B|B34,W35
[done] 3/500 ply-2 side=B move=7,6 score=2348180 depth=8 nodes=12029952 nps=800716 elapsed=15024ms total=45s eta=2h04m queue=7 json~65B
[start] 4/500 ply-2 ply=2 side=B queue=14 key=B|B2p,W3j
[done] 4/500 ply-2 side=B move=5,5 score=2453330 depth=8 nodes=11976704 nps=797118 elapsed=15026ms total=1m00s eta=2h04m queue=14 json~91B
[start] 5/500 ply-2 ply=2 side=B queue=21 key=B|B34,W3k
[done] 5/500 ply-2 side=B move=5,7 score=2546740 depth=8 nodes=12135424 nps=807413 elapsed=15030ms total=1m15s eta=2h03m queue=21 json~117B
[start] 6/500 ply-3 ply=3 side=W queue=28 key=W|B2p,B34,W3j
[done] 6/500 ply-3 side=W move=5,5 score=231080 depth=8 nodes=11585536 nps=771084 elapsed=15026ms total=1m30s eta=2h03m queue=28 json~146B
[start] 7/500 ply-3 ply=3 side=W queue=35 key=W|B2p,B2q,W3j
[done] 7/500 ply-3 side=W move=6,8 score=2029660 depth=8 nodes=11595666 nps=771655 elapsed=15027ms total=1m45s eta=2h03m queue=35 json~176B
[start] 8/500 ply-3 ply=3 side=W queue=42 key=W|B2p,B34,W3y
[done] 8/500 ply-3 side=W move=5,8 score=936100 depth=8 nodes=11473920 nps=763808 elapsed=15023ms total=2m00s eta=2h03m queue=42 json~205B
[start] 9/500 ply-3 ply=3 side=W queue=49 key=W|B2p,B35,W3j
[done] 9/500 ply-3 side=W move=5,5 score=198000 depth=8 nodes=11518976 nps=766450 elapsed=15031ms total=2m15s eta=2h02m queue=49 json~234B
[start] 10/500 ply-3 ply=3 side=W queue=55 key=W|B2o,B2q,W3i
[done] 10/500 ply-3 side=W move=7,9 score=750000 depth=8 nodes=11587584 nps=771272 elapsed=15027ms total=2m30s eta=2h02m queue=55 json~262B
```

开头字段：

- `thinkMs=15000`：每个局面离线搜索 15 秒。
- `workers=22`：生成器使用 22 个 Node Worker，约等于 24 核机器的 90%。
- `maxEntries=500`：保存到 500 个局面后停止。
- `maxPly=8`：开局树最多扩展到前 8 个 ply。
- `radius=4`：早期候选回应限制在中心区域，避免边缘污染。
- `branch=8`：当前方最佳手确定后，最多把 8 个合理回应加入队列。
- `run=...json`：这组参数写入这个 run 文件。同参数再次运行会续算它。
- `activate=no`：本轮不会更新 `manifest.json`，网页暂时不会使用这个 run。
- `resumeEntries=0`：启动时没有从这个 run 文件读到已有条目。
- `output=...`：实际写入的 run 文件路径。

单个局面字段：

- `[start] 3/500`：准备搜索第 3 个要保存的局面。
- `ply-2` 和 `ply=2`：这个局面已经有 2 颗棋子。多次出现 `ply-2` 或 `ply-3` 是不同分支，不是重复计算。
- `side=B` 或 `side=W`：当前轮到黑棋或白棋。
- `queue=7`：当前局面出队后，等待搜索的队列长度。
- `key=B|B34,W35`：经过对称和平移归一化后的规范 key。字母表示棋子颜色，后面的 36 进制数字表示棋盘索引。
- `[done]`：这个局面已经搜索完成，并写入 run 文件。
- `move=7,6`：选出的最佳落子，格式是 `行,列`。
- `score=2348180`：Rust 引擎给最佳落子的评估分。对当前行动方来说越高越好。
- `depth=8`：这个局面迭代加深完整完成到的最大深度。
- `nodes=12029952`：所有 Worker 分片合计搜索的节点数。
- `nps=800716`：每秒搜索节点数。
- `elapsed=15024ms`：这个局面的实际耗时。接近 15000ms 表示时间预算正在被用满。
- `total=45s`：当前生成器进程已经运行的总时间。
- `eta=2h04m`：预计剩余时间。它按本次进程已经完成的 entries 平均速度估算；断点续算读进来的历史 entries 不会参与平均值，避免 ETA 被算得过小。
- `json~65B`：当前紧凑条目数据的大概体积。

第一条通常会选择中心点 `(7,7)`，因为棋盘为空。后面的日志会进入不同的人类回应和 AI 回应分支，所以同一个 ply 数会出现多次。

这个 key 是项目内部压缩格式，不是通用五子棋记谱。每个棋盘点先转成一个索引：`row * 15 + col`，再用 36 进制写出来。选择 36 进制是因为 JavaScript 原生支持 `toString(36)` 和 `parseInt(value, 36)`，而 15x15 的 225 个点最多只需要两个 36 进制字符。用两个十六进制坐标也能做，但那会变成另一套自定义坐标格式，而且不会比一个 36 进制索引更短。
