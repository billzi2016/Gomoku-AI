# Algorithm

This page explains how the engine chooses a move. It starts with board encoding and ends with the search result shown in the browser.

## 1. Board state

The board is 15 by 15, so it has 225 intersections. The engine stores it in row-major order:

```text
index = row * 15 + col
```

Examples:

```text
(0, 0) -> 0
(0, 1) -> 1
(1, 0) -> 15
(7, 7) -> 112
```

JavaScript sends Rust a 225-entry array:

```text
1   black stone
-1  white stone
0   empty point
```

This format is easy to inspect and pass across the Wasm boundary. Rust builds a `Board` from it.

## 2. Why Bitboards are used

An array is convenient for asking "what is at row 7, column 7?" Win detection is faster with bits.

A 15x15 board has 225 points, so one `u64` is not enough. Rust uses four `u64` values for each side:

```text
black_bits: [u64; 4]
white_bits: [u64; 4]
```

Each bit says whether that side owns one board point. The bit index is still `row * 15 + col`.

The engine keeps both forms:

- `cells` for readable coordinate evaluation.
- Bitboards for fast five-in-a-row checks.

## 3. Five-in-a-row with shift-and

A line on the board becomes a fixed stride in the one-dimensional index:

```text
horizontal:       +1
vertical:         +15
diagonal down:    +16
diagonal up/down: +14
```

If black has stones at:

```text
(7, 4), (7, 5), (7, 6), (7, 7), (7, 8)
```

their indexes are:

```text
109, 110, 111, 112, 113
```

For horizontal detection, the engine checks:

```text
bits
& (bits >> 1)
& (bits >> 2)
& (bits >> 3)
& (bits >> 4)
```

If a bit remains set, that bit is the start of five consecutive stones.

The engine also applies a direction mask. Without a mask, a horizontal shift could connect the end of one row to the start of the next row. For horizontal five, legal start columns are `0..10`.

Normal result: `has_five()` returns true for real horizontal, vertical, or diagonal five-in-a-row, and false for row-boundary accidents.

## 4. Candidate generation

Freestyle Gomoku allows every empty point. Searching every empty point is too slow. Useful moves are usually near existing stones, so Rust generates candidates within a radius of two points around occupied intersections.

Example:

```text
black at (7, 7)
white at (7, 8)
```

The engine considers nearby points like `(6, 7)`, `(8, 8)`, and `(7, 6)`. It does not waste early search time on far corners when the fight is in the center.

Each candidate receives an `order_score` once. Sorting only compares the cached number. The comparator does not apply moves or generate child positions.

Normal result: an empty board should prefer the center. A developed board should produce candidates around existing stones.

## 5. Move ordering

Alpha-Beta pruning works better when strong moves are searched first. The engine orders candidates roughly like this:

1. Win immediately.
2. Block the opponent's immediate win.
3. Create its own forcing four or broken four.
4. Block the opponent's forcing four or broken four.
5. Create its own open three.
6. Block the opponent's open three.
7. Use ordinary shape score and a small center bonus.

The center bonus is deliberately small. It helps quiet positions but cannot override a tactical threat.

Defense is not absolute. The engine must block a move that loses immediately, but it should attack when its own forcing threat is stronger than the opponent's quiet pressure. This keeps the AI from playing a full-board blocking style with no initiative.

## 6. Threat windows

Counting only continuous stones is not enough. It sees `XXXX_`, but it can miss patterns such as:

```text
XX_XX
XXX_X
X_XXX
```

Rust scans every five-cell window that contains the candidate move. For each window it asks:

```text
Does the window contain opponent stones?
How many stones would this side have after the candidate?
How many empty points remain?
Are the window ends open?
```

Example:

```text
black: X X _ X X
white to move
```

If white plays the gap, black no longer has that five-cell threat. The engine gives that defensive move a high score.

Normal result: when the human has a broken four, the AI should treat the gap and relevant ends as urgent defensive candidates.

## 7. Static evaluation

At the depth limit, Rust evaluates the board. It first computes the score from the root side's perspective, then converts it to the current side's perspective when NegaMax needs it.

Typical pattern strength:

```text
five        very high
open four   high
four        high
open three  important
two         smaller
```

These numbers are not win probabilities. They rank branches.

Normal result: forcing threats should dominate quiet shape gains. A small center bonus should not beat a required block. A forcing attack should beat a passive block against a non-forcing threat.

## 8. NegaMax search

Minimax chooses a move while assuming the opponent will also choose strong moves.

NegaMax writes this in one symmetric formula:

```text
score(position, side) = -score(position_after_move, other_side)
```

If white tries a move, the recursive call is from black's point of view. When that score returns, white negates it.

This only works if leaf and timeout scores use the current side's perspective. That is why the engine uses `relative_score()`.

Normal result: hitting the time limit should not flip good and bad moves because of a sign error.

## 9. Alpha-Beta pruning

Alpha-Beta keeps two bounds:

```text
alpha: best score the current side can already guarantee
beta:  score the opponent can already hold us below
```

If a branch cannot improve the decision, the engine stops searching that branch.

Example:

```text
Move A gives white +500.
Move B lets black hold white below +100.
```

White does not need to finish every line under Move B. Move A is already better.

Normal result: better move ordering means more pruning and fewer wasted nodes.

## 10. Iterative deepening and time

The AI usually has 5 seconds per move. Rust searches:

```text
depth 1
depth 2
depth 3
...
```

After each completed depth, the best move is stored. If time expires during the next depth, the engine returns the last complete result.

Clock checks are sampled by node count. Calling JavaScript time functions from Wasm at every node would waste search time.

Normal result: the AI returns near the time limit with a completed depth, node count, and elapsed time.

## 11. Transposition table

Different move orders can reach the same board. The transposition table stores positions already searched during the current move.

The key uses:

```text
black Bitboard
white Bitboard
side to move
```

The value stores:

```text
depth searched
score
```

A cached score is reused only when it was searched at least as deeply as the current request.

Normal result: repeated positions should not require the same full search again.

## 12. Worker parallelism

The browser creates a Worker pool using about 90% of `navigator.hardwareConcurrency`.

JavaScript first asks Rust for root candidates, then distributes those moves across Workers:

```text
Worker 1: candidate 1, 4, 7
Worker 2: candidate 2, 5, 8
Worker 3: candidate 3, 6, 9
```

Each Worker searches its shard and returns its best move. JavaScript picks the best score and merges telemetry.

Normal result: the UI remains responsive, and the search table shows aggregated nodes and NPS.

## 13. Reading an AI result

Example:

```json
{
  "r": 7,
  "c": 9,
  "score": 450000000,
  "depth": 5,
  "nodes": 13758,
  "timeMs": 100,
  "nps": 137580,
  "heatmap": []
}
```

Meaning:

- `r`, `c`: selected point.
- `score`: Minimax score. Very large positive values often mark forced tactics.
- `depth`: deepest completed iteration.
- `nodes`: searched positions.
- `timeMs`: elapsed time.
- `nps`: nodes per second.
- `heatmap`: candidate scores for display.

Normal result: a forced block can receive a very large score. That is expected.
