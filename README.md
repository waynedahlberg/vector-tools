# SVG to STEP

Convert SVG artwork into 2D STEP (AP214) geometry for Plasticity or any CAD tool. Conversion runs entirely in the browser, so files are never uploaded. Conversion history, including the STEP files, is stored in the browser's IndexedDB.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel (free plan)

The app is a single static page with no server code or environment variables. Import the repo in Vercel with the default Next.js settings, or run `npx vercel`.

## Options

| Option | What it does |
| --- | --- |
| Output | **Curves**: wireframe B-splines, one per SVG subpath. **Flat faces**: zero-thickness planar faces with holes cut out using even-odd nesting. **Both**: both in one file. |
| Curve precision | **Exact splines** keep Béziers, lines, and arcs as cubic B-splines. **Polylines** flatten to straight segments within a tolerance. |
| Exact circles & ellipses | `<circle>` and `<ellipse>` become true STEP circles and ellipses. |
| Units & scale | Output in mm or inches. Size comes from the SVG's width/height and viewBox, pixels at a chosen DPI, or 1 unit = 1 mm. Then the scale factor is applied. |
| Placement | Move the origin to the drawing's bottom-left or center, or keep SVG coordinates. The Y axis is flipped so drawings read upright in CAD. |
| Include hidden layers | Also converts elements hidden with `display:none` or `visibility:hidden`. |

Supported: `path` (all commands), `rect` (including rounded), `circle`, `ellipse`, `line`, `polyline`, `polygon`, `g`, `use`/`symbol`, nested `svg`, and all `transform` functions. Text must be converted to outlines first. Raster images are skipped.

## In Plasticity

Import with **File → Import** or drag the `.step` into the viewport. Curves import as wireframe you can select and extrude. Flat faces import as sheet bodies you can extrude directly.

## Code

- `src/lib/svg-parser.ts`: SVG DOM to transformed geometry
- `src/lib/convert.ts`: units, origin, face/hole detection, preview data
- `src/lib/step-writer.ts`: ISO 10303-21 writer
- `src/lib/history.ts`: IndexedDB history
- `src/components/app/*`: UI, built on [Fluid Functionalism](https://www.fluidfunctionalism.com) components in `src/components/ui`
