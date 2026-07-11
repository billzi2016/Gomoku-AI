# Specification

This page describes the behavior that the project is expected to provide. It focuses on what the system accepts, what it returns, and how a maintainer can tell whether the result is normal.

## Game rules

The game uses freestyle Gomoku on a 15x15 board. Black moves first. A player wins by forming five or more stones in a row horizontally, vertically, or diagonally. There are no forbidden moves. Overlines are allowed.

In human-vs-AI mode, the human is black and the AI is white. The AI gives the human the first move, so the engine must defend well instead of relying on first-player advantage.

Normal result: any empty intersection can be clicked by a human when it is that human's turn. A five-in-a-row ends the game and shows the winner without hiding the board.

## Browser runtime

The browser loads `index.html`, JavaScript modules, CSS, and the generated Wasm files. The page must be served over HTTP because Workers and Service Workers are not reliable from `file://`.

Input: static files from the repository.

Output: an interactive board, a mode menu, a search table, and a status line.

Normal result: selecting a mode hides the mode menu, the board accepts legal clicks, and the status line describes whose turn it is.

## JavaScript to Rust data flow

JavaScript sends the Rust engine a 225-entry board:

```text
index = row * 15 + col
black = 1
white = -1
empty = 0
```

The Worker also sends `isBlackTurn`, `thinkTimeMs`, and an optional root move shard. The root move shard is a `Uint8Array` where every value is `row * 15 + col`.

Rust returns a JSON string. JavaScript parses it and updates the board, table, and heatmap.

Normal result: an AI search result has a move, score, completed depth, node count, elapsed time, NPS, and heatmap. A no-move result uses `-1, -1`.

## Search behavior

The engine searches with NegaMax and Alpha-Beta pruning. Iterative deepening keeps a complete result available when the time limit expires. The transposition table reduces repeated work inside one search.

The evaluator recognizes immediate wins, forced blocks, open threes, fours, and broken fours. Defensive threat scores are intentionally strong so the AI blocks urgent human threats.

Normal result: if the human has an immediate four-in-a-row threat, the AI should return a blocking move unless it has its own immediate win.

## Heatmap

The heatmap shows relative candidate scores. It is not a probability model.

Input: `heatmap` entries from Rust, each with row, column, and score.

Output: red, yellow, and green circles on candidate points. Higher-scoring candidates may show a numeric label.

Normal result: occupied points do not need heatmap markers, and the strongest candidates should be green.

## Deployment

GitHub Pages serves the site. GitHub Actions builds the Rust/Wasm output and uploads a static artifact.

Normal result: after pushing to `main`, the Pages workflow should produce a site that can open the game and load `assets/wasm/gomoku_ai.js`.
