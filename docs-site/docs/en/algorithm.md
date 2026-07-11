# Algorithm

This page explains how the engine chooses a move. It starts with board encoding and ends with the search result shown in the browser.

Read each section as one layer of the same question:

- Input: what the browser, Worker, or Rust engine receives.
- Work: what waste this layer removes, or what pattern it recognizes.
- Output: what the next layer receives.
- Normal result: how to judge the move, score, depth, nodes, and timing shown in the UI.

If you only want to check whether the engine is doing real search, focus on candidate generation, move ordering, threat windows, NegaMax, and Alpha-Beta. Those parts decide whether the AI is calculating lines or only applying surface-level scores.

<a id="actual-engine-algorithm"></a>

## Actual Engine Algorithm

This section documents the algorithm and numbers used by the current project code. The Wasm export is `search_best_move()` in `rust-ai/src/lib.rs`; search lives in `rust-ai/src/search.rs`; board representation and win detection live in `rust-ai/src/board.rs`; evaluation and move ordering live in `rust-ai/src/evaluate.rs`; candidate generation lives in `rust-ai/src/movegen.rs`.

### Real Move Flow

When the AI moves, the browser does not send a full search tree to Rust. JavaScript owns the UI, board array, and Worker pool, then sends the current position to Wasm.

`search_best_move()` receives:

```text
cells             225-entry board, 1 black, -1 white, 0 empty
is_black_turn     whether black is to move; in human-vs-AI mode the AI is usually white, so this is often false
think_time_ms     default 5000 milliseconds
allowed_moves     candidate points assigned to this Worker, encoded as row * 15 + col
```

Rust handles the input in this order:

1. `Board::from_cells()` converts the 225-entry array into `cells`, `black_bits`, and `white_bits`.
2. `root_moves()` decodes `allowed_moves` and verifies that each point is inside the board and empty.
3. If `allowed_moves` is empty, `generate_candidates()` creates root candidates in Rust.
4. If `think_time_ms <= 2`, Rust returns only the candidate heatmap and does not start recursive search; JavaScript uses this quick request before splitting work across Workers.
5. Normal search starts iterative deepening at depth 1, with a maximum depth of `12`.
6. Each root candidate is placed on a cloned board, then `negamax()` searches the opponent's reply.
7. At depth 0, full board, or sampled timeout, `relative_score()` returns a score from the current side's perspective.
8. The root first calls `root_forcing_score()` to check immediate wins, required blocks, own VCF, and opponent VCF.
9. A depth updates the global best move only if every root candidate at that depth completed; if time expires halfway through the root list, that partial layer is discarded.
10. Rust returns `r`, `c`, `score`, `depth`, `nodes`, `time_ms`, `nps`, and `heatmap`.

Normal output checks:

```text
r,c       should be an empty point and should come from this Worker's allowed_moves unless this is an unsharded root search.
depth     should be greater than 0 during normal thinking; heatmap-only requests may return 0.
nodes     should be greater than 0 during normal search.
time_ms   is usually close to 5000 ms; very short searches often mean a forcing tactic was found early.
heatmap   should cover candidate empty points, not occupied stones.
```

### Current Search Width And Time

Current constants in `rust-ai/src/search.rs`:

```text
ROOT_LIMIT   = 36
CHILD_LIMIT  = 22
MAX_DEPTH    = 12
TT_SIZE      = 1 << 18
```

Their meaning:

- The root keeps up to 36 candidates so attacking moves are less likely to be cut before Worker sharding.
- Child nodes keep up to 22 candidates so Alpha-Beta can verify replies after an attack.
- Iterative deepening searches up to depth 12; if time expires first, Rust returns the last completed depth.
- The transposition table uses fixed-size slots to avoid repeated growth and rehashing during search.

There is no fixed time margin subtracted from the budget. Rust sets:

```text
deadline = Date.now() + think_time_ms
```

The recursive search samples the clock by node count instead of calling the JavaScript time function at every node. This avoids spending too much Wasm time on clock checks. In a normal search, the table time is close to 5 seconds. If it returns in a few dozen milliseconds, the root usually found an immediate win, required block, or forcing four.

### Candidate Generation

Freestyle Gomoku allows every empty point, but searching all 225 points would explode the branching factor. The current `generate_candidates()` rule is:

```text
empty board: return only center (7, 7)
non-empty board: scan empty points within radius 2 of existing stones
ordering: compute quick_move_score() once per candidate
cutoff: keep the top limit moves by order_score
```

One performance rule matters here: sorting compares only cached `order_score` values. The comparator does not place moves, recurse, or generate child positions. This prevents move ordering from becoming a hidden search cost.

### Real Move Ordering Values

Current tactical thresholds in `rust-ai/src/evaluate.rs`:

```text
WIN_NOW          = 40_000_000
BLOCK_WIN_NOW    = 35_000_000
FORCE_FOUR       = 8_000_000
OPEN_THREE       = 1_500_000
DOUBLE_THREAT    = 4_500_000
```

`quick_move_score()` uses this real ordering:

```text
own immediate five:       WIN_NOW
opponent immediate five:  BLOCK_WIN_NOW
own forcing four:         34_000_000 + attack_threat + attack_fork
block forcing four:       30_000_000 + defend_threat + defend_fork
own double threat:        22_000_000 + attack_threat + attack_fork
block double threat:      18_000_000 + defend_threat + defend_fork
own open three:           11_000_000 + attack_threat + attack_fork
block open three:          7_000_000 + defend_threat + defend_fork
quiet position: center_bonus + attack * 8 + defend * 4 + attack_threat * 3 + defend_threat * 2 + attack_fork + defend_fork / 2
```

These values define the current attack-defense balance:

- If the AI can win now, that is highest priority.
- If the opponent can win next move, the AI must block.
- If both sides have forcing threats, the AI prefers creating its own forcing four.
- In quiet positions, attack is weighted higher than defense so the board does not drift into pure blocking.
- Defense still exists, but it mainly handles immediate losses and forcing lines.

### Root Tactical Shortcuts

Root search has two tactical shortcut layers. The first one is `root_forcing_score()` from `rust-ai/src/threat.rs`, which handles immediate wins, immediate blocks, and VCF continuous-four search.

VCF receives the current board, a candidate move, and the side to move. It returns an optional score:

```text
own immediate five:                     620_000_000
block opponent immediate five:          580_000_000
own VCF forced win:                     540_000_000
move allows opponent immediate/VCF win: -540_000_000 or lower
no proved forcing line:                 None, return to normal search
```

VCF expands only moves that create a direct winning point for the next move. The defender only has to try blocking those direct winning points. A move is treated as a forced win only when every defensive block still leads back to attacker VCF. This restriction matters: it makes the AI more aggressive, but it does not treat every open three as already won.

The second layer is `root_tactical_score()`, which returns early only for highly forcing local cases:

```text
own immediate five:      500_000_000
opponent immediate five: 450_000_000
move creates at least two direct winning replies: 380_000_000 + winning_reply_count * 10_000_000
own forcing four:        300_000_000 + attack_threat + attack_fork
block forcing four:      270_000_000 + defend_threat + defend_fork
```

"Move creates at least two direct winning replies" handles follow-up pressure. For example, if white already has a double-three structure, a move that gives white two immediate winning points next turn should keep the attack going because the opponent can usually block only one.

Ordinary open threes do not shortcut root search. They raise move ordering, so Alpha-Beta searches them early, but the engine still checks the opponent's reply. This avoids attacking blindly when the opponent has a stronger counter.

### Five-Cell Windows And Double Threats

`window_threat_stats()` scans every five-cell window containing the candidate point. Each window is scored by `score_window()`:

```text
5 own stones:                    50_000_000
4 own stones, 1 empty, two open:  12_000_000
4 own stones, 1 empty, one open:   8_000_000
4 own stones, 1 empty, closed:     4_000_000
3 own stones, 2 empty, two open:   1_500_000
3 own stones, 2 empty, one open:     450_000
2 own stones, 3 empty, two open:      45_000
other:                                  0
```

It also counts:

```text
force_count       windows scoring at least FORCE_FOUR
open_three_count  windows scoring at least OPEN_THREE
```

`fork_bonus()` uses those counts to identify multi-threat moves:

```text
two or more forcing fours:       18_000_000
one forcing four + one open three: 9_000_000
two or more open threes:          4_500_000
```

This is the main reason the current engine attacks more than a purely defensive version. If one move creates two problems, the opponent can often answer only one of them, giving the AI a path into a winning line.

### Global Window Evaluation

Static evaluation does not only scan continuous stones. `score_side()` also runs a full-board five-cell sliding-window evaluation, so existing broken fours, jump threes, and open threes are visible at leaf nodes.

This keeps move ordering and leaf evaluation consistent:

```text
Move ordering: XX_XX is a forcing threat.
Leaf evaluation: XX_XX must still be understood as a forcing threat, not as two quiet twos.
```

The classifier checks where the empty points are inside the five-cell window. `XX_XX` is a forcing four, but not a true open four; `X_X_X` is a jump three or closed three, not a true open three.

### Static Pattern Scores

`pattern_score()` is used for continuous lines and local shape:

```text
five or longer: 20_000_000
open four:       3_200_000
four:              360_000
open three:        110_000
three:              12_000
open two:            3_500
two:                   600
single with two ends:    80
other:                  10
```

This is not a probability table. It gives leaf positions comparable integer scores. The final move still comes from NegaMax backing up many searched leaf scores to the root.

### Verifying With The Search Table

The right-side "AI Search Score" table shows whether these engineering choices are active:

- `Depth`: the completed iterative-deepening depth. More complex positions may finish at lower depth.
- `Nodes`: the number of searched positions. A wider candidate set usually raises this number.
- `NPS`: nodes per second, mostly reflecting hardware and Wasm execution speed.
- `Time`: normal searches are close to 5 seconds; forcing tactics can return much earlier.
- `Score`: huge values usually indicate immediate five, required block, or forcing four; ordinary integers are heuristic/search estimates.
- `Heatmap`: green points should cluster around wins, blocks, forcing fours, double threats, and open threes; red points are usually nearby but less relevant candidates.

If the AI should be thinking but the table does not add a row, first check Worker and Wasm loading. If the table adds a row with `depth = 0`, it is usually a heatmap-only request or the search did not enter the normal sharded path.

<a id="algorithm-deep-dive"></a>

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

A real transfer looks like this:

```text
The user clicks (7, 9)
index = 7 * 15 + 9 = 114
If the current side is white, JavaScript writes board[114] = -1
The Worker sends the 225-entry array to Rust
Rust rebuilds cells, black_bits, and white_bits
```

The input is the whole board, not only the last move. That makes the worker path more robust: even if a Worker restarts, it can rebuild the position from the full board instead of relying on cached history.

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

The four-`u64` layout uses this bucket mapping:

```text
bucket = index / 64
offset = index % 64
mask   = 1_u64 << offset
```

For `(7, 7)`, the index is `112`:

```text
bucket = 112 / 64 = 1
offset = 112 % 64 = 48
mask   = 1_u64 << 48
```

If white owns that point, bit 48 in `white_bits[1]` is set. Checking the point is a single bit test:

```text
white_bits[1] & (1_u64 << 48) != 0
```

The point of this structure is not complexity for its own sake. It turns repeated board checks into bit operations that CPUs handle efficiently.

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

An easy false-positive case is:

```text
(0, 13), (0, 14), (1, 0), (1, 1), (1, 2)
```

Those indexes are consecutive in the one-dimensional array, `13..17`, but they are not a horizontal five on the board. The direction mask blocks this row-wrap mistake.

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

Move ordering is not the final answer. It only decides what to search first. If a high-priority candidate allows a stronger reply, NegaMax can still reject it after the deeper search.

Good ordering should show up in three kinds of positions:

```text
The AI has an immediate winning move: search it first.
The human can win next move: search the block first.
Neither side has a direct kill: prefer improving the AI's own open-three and open-four threats over patching distant weak points.
```

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

Compare two patterns:

```text
X X X _ _
```

This is a three with two empty points. It matters, but it is not an immediate win.

```text
X X _ X X
```

This is a broken four. If the gap is not handled, black can fill it and make five. Defending that point must rank much higher than responding to an ordinary three.

One candidate can belong to multiple windows. A point that blocks the opponent's broken four and also creates the AI's open three receives a stronger combined score. That is why the heatmap can show a clearly dominant point.

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

Static evaluation means "estimate who is better when the search stops here." Its input is a full board, and its output is an integer:

```text
positive: better for the root side
negative: worse for the root side
near 0: roughly balanced
```

The score is not a move probability and not a stone-count lead. In Gomoku, one key point can matter more than many quiet connections, so the evaluation gives forcing threats more weight than ordinary shape.

Normal result: forcing threats should dominate quiet shape gains. A small center bonus should not beat a required block. A forcing attack should beat a passive block against a non-forcing threat.

## 8. NegaMax search

Minimax chooses a move while assuming the opponent will also choose strong moves.

NegaMax writes this in one symmetric formula:

```text
score(position, side) = -score(position_after_move, other_side)
```

If white tries a move, the recursive call is from black's point of view. When that score returns, white negates it.

This only works if leaf and timeout scores use the current side's perspective. That is why the engine uses `relative_score()`.

A two-ply example:

```text
White has two candidates:
A: white creates an open four, but black can block it, final estimate +300
B: white blocks black's broken four, final estimate +800
```

White does not only ask whether the first move looks aggressive. It also includes black's best reply, so B wins.

The key NegaMax rule is that every level scores from the current side's perspective. When a recursive call returns, the caller negates the value to convert the opponent's view back into its own view.

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

A more concrete pruning sequence:

```text
White searches A first and gets +500, so alpha becomes +500.
While searching B, black finds a reply that holds white to +100.
Because +100 cannot beat +500, the rest of B can be skipped.
```

This is not guessing or random skipping. The prune is valid because both sides are assumed to choose their best available reply.

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
score flag: Exact / Upper / Lower
```

A cached score can be reused only when it was searched at least as deeply as the current request. `Exact` can return directly; `Lower` and `Upper` can cut off only when they prove the current Alpha-Beta window fails.

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
