# 开局库结果

这个目录只放浏览器运行时读取的开局库结果，不放生成逻辑。

生成后的文件：

```text
manifest.json
runs/book-*.json
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
