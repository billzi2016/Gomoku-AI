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

## Documentation site link

When published, this site is available at:

```text
https://billzi2016.github.io/Gomoku-AI/docs/
```
