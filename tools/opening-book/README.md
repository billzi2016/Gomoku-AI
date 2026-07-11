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
