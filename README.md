# SVG to STEP

Convert SVG artwork into 2D STEP (AP214) geometry for Plasticity or any CAD tool. Conversion runs entirely in the browser, so files are never uploaded. Conversion history, including the STEP files, is stored in the browser's IndexedDB.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Tests

```bash
npm test
```

Vitest runs the conversion pipeline in Node (xmldom stands in for the browser's `DOMParser`). The main fixture is `tests/fixtures/text_on_path_rocket2.svg`.

## Deploy to Vercel (free plan)

The app is a single static page with no server code or environment variables. Import the repo in Vercel with the default Next.js settings, or run `npx vercel`.

## Layout

The 3D preview (or, with no file open, the drop zone) fills the window. Everything else floats over it: the file, view tabs and undo/redo along the top; the **Source** panel on the left (checks, layers and colours, repair, shape); the **Output** panel on the right (output type, precision, size, transform, placement, with the file name and Convert pinned at the bottom); and the conversion history docked along the bottom. The 3D camera centres the drawing in the space between the panels. Open another file with the Open button, Ctrl+O, or by dropping it anywhere.

The app needs a window at least 1024 px wide; smaller screens see a note that it's best on desktop.

## Options

Every setting that changes the geometry is off by default, so the default output is exactly the uploaded SVG. **Reset geometry** turns them all off again, and **Undo/Redo** (Ctrl+Z / Ctrl+Shift+Z) steps through setting changes. The source SVG is never modified: the output is always the source plus the current settings.

| Option | What it does |
| --- | --- |
| Output | **Curves**: wireframe B-splines, one per SVG subpath. **Flat faces**: zero-thickness planar faces with holes cut out using even-odd nesting. **Both**: both in one file. |
| Curve precision | **Exact splines** keep Béziers, lines, and arcs as cubic B-splines. **Polylines** flatten to straight segments within a tolerance. Circles and ellipses can be kept as true STEP circles/ellipses. |
| Layers & colours | Top-level groups (Inkscape/Illustrator layers) and fill/stroke colours can be left out. Chosen per file. |
| Repair | **Close gaps** joins open ends within a tolerance. **Remove duplicate curves** drops exact copies (regardless of direction or start point). **Remove specks** drops shapes smaller than a size. |
| Shape | **Outline strokes** turns stroke-only shapes into closed outlines at their stroke width (caps and joins respected). **Curve cleanup** refits curves with fewer nodes within a tolerance set by the strength slider, keeping corners sharper than the chosen angle, straight lines, and exact circles. The 3D preview shows the original as a ghost, and the panel shows the node count and maximum deviation. |
| Size & units | mm or inches. Scale from the SVG's document size, pixels at a DPI, or 1 unit = 1 mm, times a scale factor; or fit to an exact width or height. |
| Transform | Rotate in 90° steps (counter-clockwise), mirror horizontally or vertically. |
| Placement | Origin at the drawing's bottom-left or center, or keep SVG coordinates. Draw on the XY (top), XZ (front) or YZ (side) plane. Optionally include hidden elements. |

Closed curves are always oriented consistently (outer boundaries counter-clockwise, holes clockwise) and start on a smooth point, because Plasticity drops closed curves whose start point is a sharp corner.

The problems list flags self-intersecting curves, open-end gaps that look unintentional, duplicates, and stroke-only shapes, with one-click fixes. The 3D preview marks open ends, crossings and joined gaps, and can show each curve's start point and direction.

Supported: `path` (all commands), `rect` (including rounded), `circle`, `ellipse`, `line`, `polyline`, `polygon`, `g`, `use`/`symbol`, nested `svg`, and all `transform` functions. Text must be converted to outlines first. Raster images are skipped, and clip paths/masks are ignored.

## In Plasticity

Import with **File → Import** or drag the `.step` into the viewport. Curves import as wireframe you can select and extrude. Flat faces import as sheet bodies you can extrude directly.

## Code

The conversion is a chain of memoised stages in `src/lib/convert.ts`: parse → select layers/colours → place (units, rotate/mirror, target size) → repair → outline strokes → cleanup → origin → orientation/seams → analysis. Each stage is a pure function of its input and settings and caches its last result, so a slider only reruns the stages after it.

- `src/lib/svg-parser.ts`: SVG DOM to transformed geometry with stable ids, layers and paint
- `src/lib/repair.ts`, `src/lib/analysis.ts`: gap closing, duplicates, specks; problem detection
- `src/lib/fit.ts`: Schneider curve fitting; `src/lib/cleanup.ts`, `src/lib/outline.ts` build on it (outlines use [Clipper2](https://github.com/countertype/clipper2-ts))
- `src/lib/step-writer.ts`: ISO 10303-21 writer
- `src/lib/history.ts`: IndexedDB history
- `src/components/app/*`: UI, built on [Fluid Functionalism](https://www.fluidfunctionalism.com) components in `src/components/ui`
