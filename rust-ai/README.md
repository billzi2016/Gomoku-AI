# Rust/Wasm engine

This directory contains the Gomoku AI engine. It is compiled to WebAssembly and called from browser Workers. The JavaScript layer handles UI and parallel job dispatch; Rust handles candidate generation, evaluation, Bitboard win checks, and NegaMax search.

## Files

```text
Cargo.toml      # Rust crate metadata and wasm-bindgen dependencies
src/lib.rs      # wasm-bindgen export: search_best_move()
src/types.rs    # Shared data structures serialized to JSON
src/board.rs    # Board storage, Bitboards, and five-in-a-row detection
src/movegen.rs  # Candidate generation and cached move ordering scores
src/evaluate.rs # Static evaluation and threat scoring
src/search.rs   # Iterative deepening, NegaMax, Alpha-Beta, transposition table
```

## Input and output

The exported function is:

```rust
search_best_move(cells, is_black_turn, think_time_ms, allowed_moves) -> String
```

Inputs:

```text
cells           # 225 board values: black 1, white -1, empty 0
is_black_turn   # true means black searches, false means white searches
think_time_ms   # time budget for this Worker
allowed_moves   # optional root moves encoded as r * 15 + c
```

Output is a JSON string because it is simple and stable across the Wasm boundary:

```text
r, c, score, depth, nodes, timeMs, nps, heatmap
```

## Board model

The engine keeps two views of the same position.

`cells` is a 225-entry array. It makes coordinate-based evaluation easy to read.

`black_bits` and `white_bits` are four `u64` values each. A 15x15 board has 225 points, so one `u64` is not enough. Bit index `row * 15 + col` maps a board point to a bit.

Win detection uses Bitboard shift-and checks. For example, horizontal five-in-a-row uses stride `1`; vertical uses `15`; diagonals use `16` and `14`. Direction masks stop shifts from producing false wins across row edges.

## Search

The search uses NegaMax, which is a compact form of Minimax. It assumes the current player wants the highest score and the opponent will also choose strong moves. Recursive results are negated when turns switch.

Alpha-Beta pruning skips branches that cannot change the current decision. This only works well when strong moves are searched first, so candidate ordering matters.

Iterative deepening searches depth 1, then depth 2, and continues until the time limit or maximum depth. If time expires, the engine returns the best move from the latest completed depth.

The transposition table caches positions during a single move search. The key is derived from the black and white Bitboards plus the side to move.

## Threat scoring

Gomoku requires direct tactical defense. The evaluator handles:

- immediate winning moves,
- immediate blocks,
- fours,
- broken fours such as `XX_XX`, `XXX_X`, and `X_XXX`,
- open threes that can lead to forcing sequences.

The engine does not make defense absolute. Immediate losses and strong fours still force defense, but the AI's own forcing attack is scored above the opponent's quiet threat. This prevents the engine from filling the board with passive blocks when it can take the initiative.

The current move-ordering balance is:

```text
win now
block opponent win now
create own forcing four or broken four
block opponent forcing four or broken four
create own open three
block opponent open three
ordinary attack and defense shape score
```

## Performance notes

The engine avoids generating child positions inside sort comparators. Candidate scores are computed once and stored in `ScoredMove`.

Immediate win checks use temporary Bitboard placement through `would_win()` instead of cloning the whole board.

Recursive timeout checks are sampled by node count. Calling `Date.now()` from Wasm crosses into JavaScript, so checking it at every node would waste time.

## How to build

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir ../assets/wasm --out-name gomoku_ai target/wasm32-unknown-unknown/release/gomoku_ai.wasm
```

The browser loads `../assets/wasm/gomoku_ai.js`.

## How to judge normal behavior

For an empty board, the candidate generator should prefer the center point. If the opponent has four in a row with an open end, the engine should return a blocking move. Search output should include nonzero nodes, a completed depth, elapsed time, and a heatmap.
