# Opening Book Results

This directory contains only the opening-book data loaded by the browser runtime.

Generated file:

```text
manifest.json
runs/book-*.json
sgf/book-*.sgf
vis/book-*/0001.jpg
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

SGF export:

```bash
python3 assets/opening-book/json2sgf.py
```

The script reads every `runs/*.json` file and writes a same-name file under `sgf/`. SGF is for inspection and exchange with board-game tools. It is a reproducible export artifact, so generated `.sgf` files are not committed by default. The browser still uses `manifest.json` and the compact JSON run because that format is faster to load and match.

JPG visualization:

```bash
python3 assets/opening-book/json2jpg.py
```

The renderer reads `runs/*.json` directly and writes board images under `vis/<run-name>/`.

For example:

```text
runs/book-t15000-e500-p8-r4-b8-v1.json
vis/book-t15000-e500-p8-r4-b8-v1/0001.jpg
vis/book-t15000-e500-p8-r4-b8-v1/0002.jpg
```

Each image shows:

- the canonical 15x15 board position from one opening-book entry
- black and white stones decoded from the compact key
- a green ring around the recommended move
- the side to move, score, entry number, run name, and canonical key

The renderer does not read SGF because SGF is derived from JSON. Rendering from SGF would add an avoidable conversion layer and could introduce coordinate mistakes. JSON is the source data used by the browser runtime.

The script uses Pillow:

```bash
python3 -c "import PIL"
```

Generated `.jpg` files are reproducible export artifacts and are not committed by default. If the run is still being generated, rerun `json2jpg.py` after it reaches 500 entries so the `vis/` folder matches the final JSON.
