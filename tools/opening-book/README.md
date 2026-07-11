# Offline Opening Book Generator

This directory is reserved for opening-book generation code. It is separate from browser runtime code so long-running search, training parameters, and batch scripts do not mix with `assets/js/`.

Target output:

```text
assets/opening-book/runs/book-t15000-e500-p8-r4-b8-v1.json
assets/opening-book/manifest.json
```

Recommended generation strategy:

```text
15x15 freestyle
first 6-10 plies
center 7x7 or 9x9 candidate region
human black first, AI white replies optimized
15s Alpha-Beta / Bitboard search per key position
symmetry-normalized key -> best move
```

The result file must use the compact format:

```text
[canonicalKey, canonicalMoveIndex, score]
```

The runtime does not care how the book was produced. It reads `assets/opening-book/manifest.json`, then loads the run file named by `active`. The generator reuses `assets/js/ai-search-core.js`, so offline search and browser search use the same root-sharding and result-merging logic.

SGF export lives next to the generated data:

```text
python3 assets/opening-book/json2sgf.py
```

The exporter reads `assets/opening-book/runs/*.json` and writes indented `assets/opening-book/sgf/*.sgf`. It reconstructs the best available variation tree from canonical positions. SGF is for review and interchange, and generated `.sgf` files are reproducible export artifacts rather than default committed source. The browser runtime keeps using compact JSON for speed.

The project book is expected to be generated on an Apple M2 Ultra with 24 CPU cores. Treat that as the baseline. Do not regenerate and activate a book from a weaker or similar machine unless you increase the thinking time enough to compensate. Default time estimate: `500 entries * 15s = 7500s = 125 minutes`, about 2 hours 5 minutes of pure search time and roughly 2 to 2.5 hours wall time.

Current generation command:

```text
./tools/opening-book/generate-opening-book.sh
```

Scale controls:

```text
THINK_MS=15000 MAX_ENTRIES=500 MAX_PLY=8 RADIUS=4 BRANCH=8 WORKERS=22 ./tools/opening-book/generate-opening-book.sh
```

Resume and activation:

```text
same parameters -> resume the same runs/book-*.json file
different parameters -> write a different runs/book-*.json file
ACTIVATE=1 -> update manifest.json after the run completes
```

## Reading the Log

Example output:

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

Header fields:

- `thinkMs=15000`: each searched position receives a 15-second offline budget.
- `workers=22`: the generator uses 22 Node Workers, matching about 90% of a 24-core machine.
- `maxEntries=500`: generation stops after 500 stored positions.
- `maxPly=8`: the opening tree is expanded only through the first 8 plies.
- `radius=4`: early candidate replies are restricted to the center region.
- `branch=8`: after the best move is chosen, up to 8 reasonable replies are queued.
- `run=...json`: this parameter set writes to that run file. Running the same parameters resumes the same file.
- `activate=no`: the run is not exposed to the web game yet because `manifest.json` is not updated.
- `resumeEntries=0`: no previous entries were loaded from this run file.
- `output=...`: the exact run file being written.

Per-position fields:

- `[start] 3/500`: the third stored entry is about to be searched.
- `ply-2` and `ply=2`: this position has two stones already placed. Repeated `ply-2` or `ply-3` lines are different branches, not duplicate work.
- `side=B` or `side=W`: the side to move in this position, black or white.
- `queue=7`: the number of queued positions waiting after the current one is removed.
- `key=B|B34,W35`: the canonical key after symmetry and translation normalization. The letters mark stone color, and the compact base-36 numbers mark board indexes.
- `[done]`: the position has been searched and written to the run file.
- `move=7,6`: the selected best move as `row,column`.
- `score=2348180`: the Rust engine evaluation for the best move. Higher is better for the side to move.
- `depth=8`: the deepest fully completed iterative-deepening depth for this position.
- `nodes=12029952`: total searched nodes across the Worker shards.
- `nps=800716`: searched nodes per second.
- `elapsed=15024ms`: wall time for this position. Values near 15000 ms mean the time budget is being used.
- `total=45s`: elapsed wall time since this generator process started.
- `eta=2h04m`: estimated remaining time. It is based on the average speed of entries completed in the current process, so resumed entries from an older run do not make the estimate artificially small.
- `json~65B`: approximate compact entry payload size so far.

The first line usually chooses the center `(7,7)` because the board is empty. Later lines branch into different human replies and AI replies, which is why the same ply number can appear several times.

The key format is an internal compact format, not a standard Gomoku notation. Each board point is stored as one index, `row * 15 + col`, then encoded with base36. Base36 is used because JavaScript has native `toString(36)` and `parseInt(value, 36)` support, and all 225 points on a 15x15 board fit in at most two base36 characters. Two hexadecimal coordinates would also work, but it would be a custom coordinate format and would not be shorter than one compact base36 index.
