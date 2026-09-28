# VectorTools

Two tools in one browser app. **Vectorize** traces raster images (PNG, JPEG, WebP, GIF, BMP, AVIF) into SVG paths. **STEP Convert** turns SVG artwork into 2D STEP (AP214) geometry for Plasticity or any CAD tool. Conversion runs entirely in the browser, so files are never uploaded. Conversion history, including the STEP files, is stored in the browser's IndexedDB.

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

Vitest runs the conversion pipeline in Node (xmldom stands in for the browser's `DOMParser`). The main fixture is `tests/fixtures/text_on_path_rocket2.svg`. The tracer's own Rust tests run with:

```bash
npm run test:wasm
```

### Rebuilding the tracer

The image tracer is a Rust crate in `crates/vectorize`, compiled to WebAssembly. The build output in `src/lib/vectorize/wasm` is committed, so the app (and Vercel) build without Rust. After changing the crate, rebuild it with [rustup](https://rustup.rs), the `wasm32-unknown-unknown` target and [wasm-pack](https://rustwasm.github.io/wasm-pack/):

```bash
npm run build:wasm
```

## Deploy to Vercel (free plan)

The app is a single static page with no server code or environment variables. Import the repo in Vercel with the default Next.js settings, or run `npx vercel`.

## Modes

Switch with the tabs at the top left. Each mode keeps its own file and settings, and dropping a file anywhere opens it in the right mode (SVGs in STEP Convert, images in Vectorize).

- **STEP Convert** converts vector artwork to CAD geometry. Everything below the Vectorize section describes this mode.
- **Vectorize** traces a raster image into coloured vector paths. Download the SVG, or **Continue in STEP Convert** to convert the trace to CAD.

## Vectorize

The left **Trace** panel sets how the image is read; the right **Result** panel shows the paths, nodes and colours produced, with the download and hand-off pinned at the bottom. The canvas pans (drag) and zooms (wheel, around the cursor); double-click fits. **Traced** shows the result, **Outlines** draws the paths over a faded original to judge the fit, and **Original** shows the image.

| Option | What it does |
| --- | --- |
| Preset | Logo, Illustration, Line art or Photo. Changing any setting afterwards shows "Custom". |
| Colours | **Colour** reduces the image to a fixed number of colours with k-means in OKLab (perceptually even), or groups colours by similarity when set to Auto (colour precision, gradient step). **Black & white** traces one ink colour below a luminance threshold, optionally the light areas instead. |
| Clean up | Denoise (median filter) for JPEG noise and soft edges; remove specks under a size; the opacity below which pixels count as transparent. |
| Curves | Smooth (Bézier), Polygon or Pixels. Corner threshold, segment length and splice angle control the fit. **Simplify** refits the traced curves with fewer nodes: straight edges become single lines and slightly rounded corners become sharp. |
| Layering | **Cut out** (default) makes every colour region disjoint, which is what STEP faces and cutting need. **Stacked** layers shapes like paper cut-outs: fewer paths, but they overlap. |
| Resolution | Auto enlarges small images to 1024 px and reduces large ones to 2048 px, which gives smoother curves at a bounded cost. Fixed sizes and the original size are also available. |
| Colours (Result panel) | Click a colour to leave it out of the SVG, typically the background. |

The SVG keeps the image's pixel size as its document size, so at 96 DPI one image pixel is 0.2646 mm in STEP Convert; set the real size there with **Fit width** or **Fit height**.

### How tracing works, and its limits

Tracing uses the clustering and curve fitting of [VTracer](https://github.com/visioncortex/vtracer) (visioncortex, MIT/Apache-2.0), with preprocessing and output of its own:

1. The file's header is read before decoding, and images over 100 megapixels (or 32,768 px a side, or 50 MB) are refused, so a small file that decodes to a huge bitmap can't exhaust memory. The browser then decodes straight to the working resolution.
2. Pixels are thresholded for transparency, median-filtered, then quantized. Anti-aliasing pixels on edges are left out of the k-means sample and colours that only blend two others are merged, so edges don't become thin extra shapes.
3. VTracer clusters the colours hierarchically and fits curves. Layer colours are snapped back to the palette, so they're exact.
4. Simplify refits the result with the same curve fitter as STEP Convert's curve cleanup.

Tracing suits logos, icons, flat illustrations and line art. Photos work but become many paths, like posterised art.

### Safety

Everything runs in the browser; images are never uploaded. Tracing runs in a dedicated Web Worker, so the page never blocks. The tracer is Rust compiled to WebAssembly: memory-safe, with no image decoder of its own, and its options and results are typed across the boundary (TypeScript types are generated from the Rust structs) and clamped on both sides. WebAssembly memory can grow but never shrink, so the worker is disposable: a newer request, a 90-second timeout, a crash, or memory above 512 MB terminates it, which frees everything, and a fresh one starts on the next trace. Traces over 1.5 million points are refused as too detailed. The SVG is written from numbers and validated colours only.

## Layout

The 3D preview (or, with no file open, the drop zone) fills the window. Everything else floats over it: the file, view tabs and undo/redo along the top; the **Source** panel on the left (checks, layers and colours, repair, shape); the **Output** panel on the right (output type, precision, size, transform, placement, with the file name and Convert pinned at the bottom); and the conversion history docked along the bottom. The 3D camera centres the drawing in the space between the panels. Open another file with the Open button, Ctrl+O, or by dropping it anywhere.

### 3D navigation (Blender-style)

- **Navigation gizmo** (top-right of the view): click X, Y or Z to animate to that axis view, always centred on the drawing's extents; click the axis you're already looking down to flip to the opposite side; drag the gizmo to orbit. Negative axes are the darker balls.
- **Auto perspective**: axis views switch to orthographic; orbiting away returns to perspective unless orthographic was chosen with the grid button.
- **Tool strip** under the gizmo: drag the magnifier to zoom, drag the hand to pan, click the grid to toggle perspective/orthographic.
- **Nodes** (spline icon in the top bar): shows the exported curves' anchor points and Bézier handles (or the vertices in polyline mode) with a live node count, handy for judging curve cleanup. Exact circles and ellipses have no nodes in STEP.
- **Mouse**: left-drag orbits, right-drag (or Shift+drag) pans, the wheel zooms. The current view's name ("Top Orthographic", "User Perspective") shows in the legend.

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

Vectorize:

- `crates/vectorize`: the Rust tracer (preprocessing in `preprocess.rs`, VTracer clustering and path output in `trace.rs`, the typed boundary in `types.rs`)
- `src/lib/vectorize/worker.ts`, `client.ts`, `protocol.ts`: the worker, its lifecycle (cancel, timeout, recycling) and messages
- `src/lib/vectorize/image-header.ts`: reads image sizes from file headers without decoding
- `src/lib/vectorize/settings.ts`, `simplify.ts`, `svg.ts`: settings and presets, node reduction, SVG output
- `src/components/app/vectorize/`: the panels, the canvas and the `useVectorizer` hook
- `src/components/app/*`: UI, built on [Fluid Functionalism](https://www.fluidfunctionalism.com) components in `src/components/ui`
