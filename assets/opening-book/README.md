# Opening Book Results

This directory contains only the opening-book data loaded by the browser runtime.

Generated file:

```text
opening-book.json
```

The JSON uses a compact format:

```text
entries: [canonicalKey, canonicalMoveIndex, score]
```

This is smaller than an object array and is suitable for scaling to thousands of entries without bloating the static asset too quickly.

Runtime flow:

```text
assets/js/opening-book.js tries to load the JSON
missing JSON falls back to normal live search
the current board is normalized across 8 symmetries plus translation
the canonical key is matched against entries
the canonical move is transformed back to the current board
```

`opening-book.json` is intentionally generated output. Recreate it from `tools/opening-book/` when you want a stronger book.
