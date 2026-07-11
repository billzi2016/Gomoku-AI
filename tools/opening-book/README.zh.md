# 离线开局库生成器

这个目录用于放开局库生成代码。它和浏览器运行时代码分开，避免把长时间搜索、训练参数或批处理脚本混进 `assets/js/`。

目标输出：

```text
assets/opening-book/opening-book.json
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

运行时代码不关心生成器如何得到结果。只要 JSON 结构不变，网页开局时就能直接 match。生成器复用 `assets/js/ai-search-core.js`，所以离线搜索和浏览器搜索使用同一套根节点分片与结果合并逻辑。

当前生成命令：

```text
./tools/opening-book/generate-opening-book.sh
```

控制规模：

```text
THINK_MS=15000 MAX_ENTRIES=500 MAX_PLY=8 RADIUS=4 BRANCH=8 WORKERS=22 ./tools/opening-book/generate-opening-book.sh
```
