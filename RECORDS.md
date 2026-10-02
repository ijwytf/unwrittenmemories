# Hidden records

The feature listens only to successfully committed searches in `main.js`.
`search-input.js` and `text-morph.js` are unchanged.

## Data updates

- Source: `2차채록정리.xlsx`, Sheet1, columns 지역 / 카테고리 / 제목 / 내용 / 키워드.
- Web data: `data/records.json` (169 records, 311 distinct keywords).
- Rebuild offline: `python scripts/build-records.py` (requires openpyxl).
- To use another workbook: `python scripts/build-records.py path/to/source.xlsx`.
- The converter preserves narrative cells exactly and splits keywords only on commas,
  trimming whitespace around each keyword. It rejects incomplete or formula-based rows.
- The browser never requests Excel and needs no spreadsheet library, server API, or database.

The existing search limits still apply: five Korean characters / eight English letters,
including spaces. The source keyword `새마을 운동` has six characters and therefore cannot
be entered under that rule. Its source spelling is deliberately preserved.

## Responsibilities

- `record-data.js`: one deferred JSON fetch, exact keyword Map, case-insensitive ASCII
  English matching, per-keyword Fisher–Yates shuffle bags. No repeats within a cycle;
  adjacent cycles also avoid immediately repeating the last record when possible.
- `record-easter-egg.js`: a version token discards stale asynchronous searches. One
  normalized text target near the center is selected once per search. Only that
  existing vertex gets a white pulse through a cloned PointsMaterial. Only its render
  depth is biased forward so dense surrounding vertices cannot hide the glow;
  actual geometry and screen x/y remain unchanged. No extra
  vertices, scenes, draw calls, or postprocessing passes. Materials and sparse
  attributes are reused, bounded by the existing clouds (at most one float per point).
- Each frame reads only the selected live position (including microphone motion),
  converts local → world → camera projection → CSS screen coordinates, and positions
  a visually transparent keyboard-accessible hit button. Desktop hit diameter is
  36px; the existing mobile quality profile selects 44px. Bloom uses existing settings.
- `record-note.js` / `records.css`: HTML paper, animation origin at that projected
  point, viewport-clamped final position, visualViewport resize/scroll handling,
  internal content scrolling, black-dot close control and Escape support.

The same search session keeps the same record. A new confirmed search, including the
same keyword, consumes the next candidate. Empty/unknown searches clear the point and
paper without messages. Credits closes the paper and hides the hit target; returning
to 3D restores the current point. Search remains available while reading a note.

## Checks

```
node --test tests/*.test.mjs
node tests/search-input-browser.cjs
node tests/browser.cjs
node tests/browser.cjs --records-only
```

Browser tests need Playwright, installed Edge, and network access to the existing
Three.js CDN. They use test-only audio sources. Physical iPhone Safari IME, microphone
permissions/recovery, touch targeting under audio, and app-background restoration
still require real-device checks. Run through HTTP, e.g. http://localhost:8000/.

In Edge mobile emulation, rotating landscape → portrait can keep the existing
canvas/layout width at 844 CSS pixels and auto-zoom the page. This reproduces with
the pre-feature `main.js` as well (`--viewport-check`). The renderer is unchanged;
note bounds are checked against visualViewport coordinates. Verify orientation
and readability on a physical iPhone separately.
