# GOMOKU AI documentation

This documentation site explains how the browser game, the JavaScript Worker layer, and the Rust/Wasm engine fit together.

Use the project README for the full project overview. Use the specification when you need a precise description of rules, data flow, and expected behavior. Use the JavaScript and Rust pages when you are changing code in those areas.

## What this project does

GOMOKU AI runs a freestyle Gomoku game in the browser. GitHub Pages serves static files. The visitor's browser supplies the CPU. The AI engine is Rust compiled to WebAssembly, and Web Workers keep the page responsive while the engine searches.

## How to read these docs

- Start with Project README if you want the big picture.
- Read How To Play for Gomoku rules, freestyle handling, and Renju forbidden-move differences.
- Read Specification if you need exact rules, inputs, outputs, and normal results.
- Read JavaScript layer before changing UI, Worker dispatch, or the heatmap.
- Read Rust engine before changing search, evaluation, Bitboards, or performance.

## Opening book generation

The web game keeps a 5-second real-time search budget. The opening book is generated offline with a 15-second per-position budget.

```bash
THINK_MS=15000 MAX_ENTRIES=500 MAX_PLY=8 RADIUS=4 BRANCH=8 WORKERS=22 ./tools/opening-book/generate-opening-book.sh
```

The output is `assets/opening-book/opening-book.json`. The generator reuses the browser AI root-sharding logic and only changes the offline time budget. Entries use symmetry and translation normalization to keep the file compact.

## Documentation site link

When published, this site is available at:

```text
https://billzi2016.github.io/Gomoku-AI/docs/
```
