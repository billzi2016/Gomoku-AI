# Opening Book Results

This directory contains only the opening-book data loaded by the browser runtime.

Generated file:

```text
manifest.json
runs/book-*.json
```

The JSON uses a compact format:

```text
entries: [canonicalKey, canonicalMoveIndex, score]
```

This is smaller than an object array and is suitable for scaling to thousands of entries without bloating the static asset too quickly.

Runtime flow:

```text
assets/js/opening-book.js tries to load manifest.json
manifest.active points to one runs/book-*.json file
missing manifest or run JSON falls back to normal live search
the current board is normalized across 8 symmetries plus translation
the canonical key is matched against entries
the canonical move is transformed back to the current board
```

Run files are generated output. Recreate them from `tools/opening-book/` when you want a stronger book, then activate the selected run through `manifest.json`.

The official project run should be generated on an Apple M2 Ultra with 24 CPU cores. Avoid replacing it with a run from a weaker or similar machine unless the run uses a longer search budget. The default estimate is `500 entries * 15s = 7500s = 125 minutes`, usually about 2 to 2.5 hours after overhead.
