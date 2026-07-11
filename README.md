# GOMOKU AI

Rust/Wasm Gomoku AI running entirely in the browser with Bitboard win detection, NegaMax Minimax, Alpha-Beta pruning, iterative deepening, transposition-table caching, threat-aware evaluation, and Web Worker root-move parallelism. The AI is designed for freestyle Gomoku: human black moves first, AI white moves second, and there are no forbidden-move rules.

[中文说明](https://github.com/billzi2016/Gomoku-AI/blob/main/README.zh.md)

## Live Demo

https://billzi2016.github.io/Gomoku-AI/

## Documentation

https://billzi2016.github.io/Gomoku-AI/docs/

## Features

- Browser-only Gomoku game deployable to GitHub Pages.
- Three modes: human-vs-AI, local two-player, and AI-vs-AI.
- Human-vs-AI mode uses human black first and AI white second.
- Freestyle Gomoku rules: no forbidden moves, no Renju restrictions, any empty point is legal.
- Rust/Wasm search engine for the compute-heavy AI core.
- Bitboard-based five-in-a-row detection over a 15x15 board.
- NegaMax Minimax search with Alpha-Beta pruning.
- Iterative deepening so the engine always has a usable best move inside the time limit.
- Transposition table to reuse searched positions during a move search.
- Threat-aware move ordering and evaluation for open threes, fours, broken fours, and immediate wins.
- Explicit attack/defense balance: forced wins and forced blocks come first, but the AI will attack when its own forcing threat is stronger than the opponent's quiet threat.
- Up to 5 seconds of thinking time per AI move.
- Web Worker pool using about 90% of local CPU threads by default.
- Candidate heatmap on the board: green is strong, yellow is medium, red is weaker.
- Search statistics panel showing depth, score, nodes, NPS, and time for each move.
- `coi-serviceworker.js` support for cross-origin isolation headers on static hosting.

## Project Layout

```text
index.html                  # Page entry, layout, mode menu, and search table
coi-serviceworker.js        # Adds COOP/COEP headers through a Service Worker
assets/css/style.css        # Global layout, score panel, controls, responsive sizing
assets/css/board.css        # Board frame, canvas sizing, and mode overlay
assets/js/main.js           # Page bootstrap
assets/js/game.js           # UI game flow, modes, turns, win checks, and stats table
assets/js/board-ui.js       # Canvas board, stones, star points, heatmap, click mapping
assets/js/ai-manager.js     # Worker pool and root candidate sharding
assets/js/ai-worker.js      # Loads Rust/Wasm and runs search jobs
assets/wasm/                # Generated browser Wasm bindings
rust-ai/                    # Rust/Wasm AI engine
server.py                   # Threaded local static server with random free port selection
.github/workflows/pages.yml # GitHub Actions build and Pages deployment
```

## Rules

This project uses freestyle Gomoku:

- Board size: 15x15.
- Black moves first.
- A player wins by making five or more consecutive stones horizontally, vertically, or diagonally.
- There are no forbidden moves.
- Overlines are allowed.
- In human-vs-AI mode, the human is always black and the AI is always white.

This means the AI is intentionally giving the human the first move. The engine compensates with deeper search, strong move ordering, and explicit threat defense.

## Local Development

Do not open `index.html` through `file://`. Web Workers, Wasm, and Service Workers need an HTTP environment.

Use the included server:

```bash
python3 server.py
```

You can also choose a port manually:

```bash
python3 server.py --port 9000
```

The server prints the actual URL, for example:

```text
http://127.0.0.1:8342/
```

On the first visit, `coi-serviceworker.js` may reload the page once so the page is controlled by the Service Worker.

## Build Rust/Wasm

Install Rust and `wasm-bindgen-cli`, then build the engine:

```bash
rustup default stable
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
```

Build:

```bash
cd rust-ai
cargo build --target wasm32-unknown-unknown --release
mkdir -p ../assets/wasm
wasm-bindgen --target web --out-dir ../assets/wasm --out-name gomoku_ai target/wasm32-unknown-unknown/release/gomoku_ai.wasm
```

Generated files:

```text
assets/wasm/gomoku_ai.js
assets/wasm/gomoku_ai_bg.wasm
```

`ai-worker.js` loads `assets/wasm/gomoku_ai.js` and calls the exported Rust function `search_best_move()`.

## Generate Opening Book

The browser game still uses a 5-second real-time search budget. The opening book is generated offline, so each key position can use a slower 15-second search without making players wait.

Generate a compact opening book:

```bash
./tools/opening-book/generate-opening-book.sh
```

Scale controls:

```bash
THINK_MS=15000 MAX_ENTRIES=500 MAX_PLY=8 RADIUS=4 BRANCH=8 WORKERS=22 ./tools/opening-book/generate-opening-book.sh
```

Output:

```text
assets/opening-book/opening-book.json
```

The generator uses the same root-sharded Worker search path as the browser AI. It only changes the offline time budget. It also uses center-limited positions, symmetry and translation normalization, and compact entries of the form `[canonicalKey, canonicalMoveIndex, score]`.

## AI Design

The engine uses a compact 15x15 board model:

- `cells`: a 225-entry array for simple coordinate evaluation.
- `black_bits`: four `u64` words for black stones.
- `white_bits`: four `u64` words for white stones.

Bit index mapping:

```text
index = row * 15 + col
```

Five-in-a-row detection uses Bitboard shift-and checks:

- stride `1`: horizontal.
- stride `15`: vertical.
- stride `16`: diagonal down-right.
- stride `14`: diagonal down-left.

Each direction also uses a precomputed legal-start mask so the bit shifts cannot create false wins across row boundaries.

## Search Strategy

The browser does not run one giant single-threaded search on the UI thread. The search flow is:

1. JavaScript asks one Worker to generate root candidates and a first heatmap.
2. JavaScript shards those root candidates across a Worker pool.
3. Each Worker loads the same Rust/Wasm engine.
4. Each Worker searches its own root-move shard.
5. JavaScript merges the best result, total nodes, maximum depth, elapsed time, and heatmap.

Inside Rust:

- Candidate generation only considers empty points near existing stones.
- Move ordering computes each candidate score once, caches it, and then sorts by the cached number.
- The sorting comparator does not generate child positions.
- NegaMax recursively searches alternating turns.
- Alpha-Beta pruning cuts branches that cannot change the final decision.
- Iterative deepening keeps the latest complete best move available.
- The transposition table caches position scores during one move search.
- Timeout handling returns scores from the current side's perspective, avoiding NegaMax sign bugs.

## Attack and Defense Balance

Gomoku AI loses quickly if it only evaluates material-like shape scores. This engine separates forced tactics from ordinary pressure:

- If the AI can win immediately, it plays the winning move.
- If the human can win immediately, the AI blocks.
- Broken fours such as `XX_XX`, `XXX_X`, and `X_XXX` are recognized with 5-cell window scoring.
- Open threes are treated as serious threats because they can become forcing sequences.
- The AI's own forcing attack is scored above the opponent's quiet threat, so the engine does not fill the board with passive blocks.
- Defensive scores are still high enough to stop immediate losses and strong fours.
- Ordinary center preference is intentionally small and cannot override urgent tactical defense.

This does not claim to be a solved Gomoku engine. It is a practical browser AI aimed at beating casual and many amateur players within a fixed 5-second move budget.

## Engine Techniques

- **Rust/Wasm**: the search core is written in Rust and compiled to WebAssembly, so all computation runs locally in the visitor's browser.
- **Bitboards**: black and white stones are stored in compact `u64` chunks. Win detection uses bit shifts and masks.
- **NegaMax Minimax**: the engine assumes both sides choose strong moves and uses a symmetric NegaMax form.
- **Alpha-Beta pruning**: branches that cannot affect the final decision are cut early.
- **Iterative deepening**: searches depth 1, then depth 2, and so on, keeping a stable best move under time pressure.
- **Transposition table**: repeated positions are cached during a search to reduce duplicated work.
- **Threat ordering**: immediate wins, forced blocks, forcing attacks, fours, broken fours, and open threes are searched before quiet moves.
- **Time sampling**: recursive timeout checks are sampled by node count to reduce expensive Wasm-to-JS time calls.
- **Web Worker parallelism**: root moves are split across Workers using about 90% of available CPU threads.
- **Search telemetry**: every AI move reports depth, Minimax score, visited nodes, nodes per second, and elapsed time.

## Heatmap

The board overlays a red/yellow/green heatmap after AI search:

- Green: strongest candidate scores.
- Yellow: medium candidate scores.
- Red: weaker candidate scores.
- Numeric labels are shown only for higher-scoring candidates to keep the board readable.

The heatmap is not a probability model. It visualizes the engine's relative candidate scores after search and threat ordering.

## Why `coi-serviceworker.js` Is Kept

The current AI parallelism model is root-move sharding across multiple Web Workers, with each Worker loading its own Wasm module. It does not require Wasm pthreads or `SharedArrayBuffer`.

`coi-serviceworker.js` is kept so static hosting such as GitHub Pages can provide cross-origin isolation headers, which leaves room for future features that may require `crossOriginIsolated`.

A normal server can set:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

GitHub Pages cannot configure custom response headers directly, so this project uses `coi-serviceworker.js` to add the required headers from the client side through a Service Worker.

## GitHub Pages Deployment

This repository includes a GitHub Actions workflow:

```text
.github/workflows/pages.yml
```

On push to `main`, the workflow:

1. Installs Rust.
2. Installs `wasm-bindgen-cli`.
3. Builds `rust-ai` for `wasm32-unknown-unknown`.
4. Generates browser-loadable files in `assets/wasm/`.
5. Uploads the static site artifact.
6. Deploys to GitHub Pages.

The workflow can also be triggered manually from the GitHub Actions page.

## Local Build and Manual Deployment

If you do not use GitHub Actions, build the Rust/Wasm output locally with the commands above, then publish the static files to your GitHub Pages branch or configured Pages directory.

Make sure these files are present:

```text
index.html
coi-serviceworker.js
assets/css/style.css
assets/css/board.css
assets/js/main.js
assets/js/game.js
assets/js/board-ui.js
assets/js/ai-manager.js
assets/js/ai-worker.js
assets/wasm/gomoku_ai.js
assets/wasm/gomoku_ai_bg.wasm
```

GitHub Pages only serves static files. All AI computation runs locally in the visitor's browser and CPU.
