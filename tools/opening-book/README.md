# Offline Opening Book Generator

This directory is reserved for opening-book generation code. It is separate from browser runtime code so long-running search, training parameters, and batch scripts do not mix with `assets/js/`.

Target output:

```text
assets/opening-book/opening-book.json
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

The runtime does not care how the book was produced. As long as the JSON format stays stable, the web game can match it directly at the opening. The generator reuses `assets/js/ai-search-core.js`, so offline search and browser search use the same root-sharding and result-merging logic.

Current generation command:

```text
./tools/opening-book/generate-opening-book.sh
```

Scale controls:

```text
THINK_MS=15000 MAX_ENTRIES=500 MAX_PLY=8 RADIUS=4 BRANCH=8 WORKERS=22 ./tools/opening-book/generate-opening-book.sh
```
