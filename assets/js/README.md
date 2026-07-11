# JavaScript frontend and Worker layer

This directory contains the browser side of GOMOKU AI. It does not implement the search engine. Its job is to draw the board, manage game modes, collect user input, split AI work across Web Workers, and display search results from Rust/Wasm.

## Files

```text
main.js       # Starts the page and creates GomokuGame
game.js       # Game modes, turns, win checks, status text, and move table
board-ui.js   # Canvas board, stones, star points, heatmap, and click mapping
ai-manager.js # Worker pool and root candidate sharding
ai-worker.js  # Loads the Wasm module and calls search_best_move()
```

## What each file does

`main.js` is the page entry. It waits for `DOMContentLoaded`, finds the board canvas, creates `GomokuGame`, and reports initialization errors in the page status area.

`game.js` owns game state. The board is a 225-entry `Int8Array`; black is `1`, white is `-1`, and empty is `0`. It supports human-vs-AI, local two-player, and AI-vs-AI modes. In human-vs-AI mode, the human is black and the AI is white.

`board-ui.js` draws the board on a canvas. It maps mouse coordinates to 15x15 intersections, draws stones and star points, and renders the AI heatmap. The heatmap input is an array of `{ r, c, score }` objects from Rust.

`ai-manager.js` owns the Worker pool. It creates about 90% of the browser-reported CPU thread count, asks Rust for root candidates, splits those candidates across Workers, and merges results.

`ai-worker.js` runs inside a Worker. It loads `assets/wasm/gomoku_ai.js`, waits for Wasm initialization, calls `search_best_move()`, parses the returned JSON, and sends the result back to the manager.

## Input and output

The frontend sends this to Rust through a Worker:

```text
cells: Int8Array(225)       # 15x15 board, row * 15 + col
isBlackTurn: boolean        # true for black search, false for white search
thinkTimeMs: number         # usually 5000
legalMoves: Uint8Array      # optional root shard encoded as r * 15 + c
```

Rust returns JSON with:

```text
r, c        # selected move, or -1/-1 when no move exists
score       # Minimax score for the selected move
depth       # completed search depth
nodes       # visited nodes
timeMs      # elapsed time in milliseconds
nps         # nodes per second
heatmap     # candidate scores for board overlay
```

## How to judge normal behavior

The board should stay responsive while the AI searches. The status text should show when the AI is thinking. After an AI move, the right panel should add a row with depth, nodes, NPS, time, and score. The heatmap should appear on empty candidate points, with green showing stronger scores.

If the page says the AI engine failed to initialize, open it through `python3 server.py` instead of `file://`. Workers and Wasm are not reliable from a local file URL.

## Why the Worker layer exists

Rust/Wasm is fast, but a long search on the main browser thread would freeze input and painting. Workers keep the UI thread free. The manager also lets the engine use multiple CPU cores by splitting root moves across Workers.
