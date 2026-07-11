# How To Play

This project runs freestyle Gomoku. The rule set is intentionally simple: black moves first, both sides take turns placing stones on empty intersections, and the first side to make five connected stones wins.

## Rules Used By This Project

The board is 15 by 15. Stones are placed on intersections, not inside squares.

In human-vs-AI mode:

```text
Human: black, first move
AI: white, second move
Forbidden moves: none
Win condition: five connected stones horizontally, vertically, or diagonally
```

"No forbidden moves" matters. Any empty point is legal. Black may play double-three, double-four, and overline moves; white may do the same. The AI does not reject a move just because that move would be forbidden under Renju rules.

Normal result: clicking an empty intersection places a black stone; black wins if black makes five; white wins if white makes five; if the board fills without five, the game is a draw.

## What Five In A Row Means

Five in a row means five stones of the same color connected on one line.

Horizontal:

```text
X X X X X
```

Vertical:

```text
X
X
X
X
X
```

Diagonal:

```text
X . . . .
. X . . .
. . X . .
. . . X .
. . . . X
```

In this project, the game ends as soon as five is made. There is no extra check for whether the move would be forbidden for black in another rule set.

## Common Shapes

In the examples below, `X` is the current side, `_` is an empty point, and `.` is an irrelevant point.

### Open Four

```text
_ X X X X _
```

An open four can be completed on either end. If the opponent blocks only one end, the other end still wins, so this is a very strong shape.

### Four

```text
O X X X X _
```

This four has only one winning endpoint. The opponent must block that empty point immediately.

### Broken Four

```text
X X _ X X
```

Filling the gap makes five. The defender must treat the gap as urgent. The AI recognizes this kind of five-cell window as a forcing threat.

### Open Three

```text
_ X X X _
```

An open three can become an open four or a forcing four. It is not an immediate win, but several open threes at once are difficult to defend.

### Double Threat

A double threat means one move creates two problems that both need answers. For example, one move may create two open threes, or a forcing four plus an open three.

Example:

```text
horizontal: _ X X X _
vertical:   _ X X X _
```

If the crossing `X` is the newly placed stone, the opponent can often block only one line. The other line keeps growing, which is why double threats are central to attacking play.

## What Renju Forbidden Moves Are

Renju is a stricter rule set. It is usually designed to reduce black's first-move advantage, so the restrictions apply to black, not white.

Common forbidden moves for black include:

```text
double-three: black creates two open threes with one move
double-four:  black creates two fours with one move
overline:     black creates six or more connected stones
```

Those restrictions are not used by this project. This project is freestyle, so black double-three, double-four, and overline moves are legal.

## Double-Three

Under Renju, if black creates two open threes with one move, that is usually called a double-three.

Example:

```text
horizontal: _ X X X _
vertical:   _ X X X _
```

If the center `X` is black's newly placed stone, black now has two open threes. Renju usually forbids this because black already has the first move, and this kind of double threat can be too strong.

In this project, it is legal. The AI treats this kind of double threat as a high-value attacking point.

## Double-Four

Double-four means black creates two fours with one move. A "four" can be an open four, a one-ended four, or a broken four.

Example:

```text
horizontal: X X _ X X
vertical:   O X X X X _
```

If the same move creates two lines that can become five next turn, the defender may not be able to handle both. Renju usually forbids this for black.

This project does not use that restriction. Double-four is legal attacking play, and the AI searches these forcing points early.

## Overline

An overline means six or more connected stones:

```text
X X X X X X
```

In Renju, black overline is usually forbidden. In freestyle rules, an overline contains five in a row, so it counts as a win.

This project uses freestyle handling: overlines are valid, and the side that makes one wins.

## Why This Project Uses Freestyle

The goal of this project is to show a Rust/Wasm AI running search, evaluation, Bitboards, Alpha-Beta pruning, Worker parallelism, and a heatmap in the browser. Freestyle rules keep the engine interface direct:

- Every empty point is legal.
- The AI can focus on attack and defense instead of first filtering forbidden moves.
- In human-vs-AI mode, the human plays black first and the AI plays white second, so the human receives the first move.

If Renju support is added later, the engine needs a separate forbidden-move detector that applies only to black. That would affect legal move generation, the heatmap, search branches, and game-end checks; it is more than a text-only change.
