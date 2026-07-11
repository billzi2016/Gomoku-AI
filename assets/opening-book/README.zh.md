# 开局库结果

这个目录只放浏览器运行时读取的开局库结果，不放生成逻辑。

生成后的文件：

```text
manifest.json
runs/book-*.json
sgf/book-*.sgf
vis/book-*/0001.jpg
```

JSON 使用紧凑格式：

```text
entries: [canonicalKey, canonicalMoveIndex, score]
```

这样比对象数组更小，后续扩到几千条也不会让静态资源膨胀太快。

运行时流程：

```text
assets/js/opening-book.js 尝试读取 manifest.json
manifest.active 指向一个 runs/book-*.json 文件
manifest 或 run JSON 不存在时自动退回实时搜索
对当前棋盘做 8 种对称加平移归一化
用规范 key 查找 entries
命中后把规范坐标反变换回当前棋盘
```

run 文件是生成产物。需要更强开局库时，从 `tools/opening-book/` 重新生成，再通过 `manifest.json` 激活选中的 run。

项目正式 run 应该在 Apple M2 Ultra 24 核 CPU 上生成。不要用更弱或差不多的机器生成结果替换它，除非这次 run 使用了更长的搜索预算。默认估算是 `500 条 * 15 秒 = 7500 秒 = 125 分钟`，算上开销通常约 2 到 2.5 小时。

SGF 导出：

```bash
python3 assets/opening-book/json2sgf.py
```

脚本会读取所有 `runs/*.json`，并在 `sgf/` 下写出同名 `.sgf` 文件。SGF 用于查看和与棋类工具交换。它是可以重复生成的导出产物，所以默认不提交生成出来的 `.sgf` 文件；浏览器运行时仍然使用 `manifest.json` 和紧凑 JSON run，因为这个格式加载和匹配更快。

JPG 可视化：

```bash
python3 assets/opening-book/json2jpg.py
```

渲染器直接读取 `runs/*.json`，并把棋盘图片写到 `vis/<run-name>/`。

例如：

```text
runs/book-t15000-e500-p8-r4-b8-v1.json
vis/book-t15000-e500-p8-r4-b8-v1/0001.jpg
vis/book-t15000-e500-p8-r4-b8-v1/0002.jpg
```

每张图片会显示：

- 一个开局库 entry 对应的规范 15x15 棋盘
- 从紧凑 key 解码出的黑白棋子
- 用绿色圆环标出的推荐落子
- 当前行动方、评分、entry 编号、run 名称和 canonical key

渲染器不读取 SGF，因为 SGF 本身也是从 JSON 导出的。再从 SGF 渲染会多一层不必要的转换，也更容易引入坐标误差。JSON 才是浏览器运行时真正使用的源数据。

脚本依赖 Pillow：

```bash
python3 -c "import PIL"
```

生成出来的 `.jpg` 是可重复生成的导出产物，默认不提交。如果 run 还在生成中，等它到 500 entries 后再运行一次 `json2jpg.py`，让 `vis/` 目录和最终 JSON 对齐。
