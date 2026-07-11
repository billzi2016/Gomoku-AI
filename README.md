# Gomoku AI

A browser-only Gomoku AI for GitHub Pages. The human plays black first, and the AI plays white with freestyle rules and no forbidden-move restrictions.

## Features

- Rust/Wasm engine for the search-heavy AI core.
- Bitboard-oriented board representation and compact candidate generation.
- NegaMax Minimax with Alpha-Beta pruning, iterative deepening, and a transposition table.
- Web Worker pool using about 90% of local CPU threads by default.
- Five-second maximum thinking time per AI move.
- Candidate heatmap on the board: green is stronger, yellow is medium, red is weaker.
- Search table with depth, nodes, NPS, time, and Minimax score.
- `coi-serviceworker.js` for COOP/COEP headers on GitHub Pages.

## Build

Install Rust, the Wasm target, and wasm-bindgen:

```bash
rustup default stable
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
```

Build the engine:

```bash
cd rust-ai
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir ../assets/wasm --out-name gomoku_ai target/wasm32-unknown-unknown/release/gomoku_ai.wasm
```

## Local Preview

```bash
python3 server.py
```

The server prints a random free local URL.

## Deployment

The GitHub Actions workflow builds the Rust/Wasm engine and uploads the static site to GitHub Pages.

## Architecture Notes

The AI does not use Wasm pthreads. It uses multiple browser Web Workers, and each worker loads the same Rust/Wasm module to search a shard of the root candidate moves. The Service Worker still enables cross-origin isolation headers, which keeps the deployment ready for stricter browser APIs.
