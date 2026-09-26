import {
  boundsOf,
  flatten,
  pointInPolygon,
  signedArea,
  reverseShape,
  smoothSeam,
  transformShape,
  type Bounds,
  type PathShape,
  type Mat,
  type Pt,
  type Shape,
} from "./geometry";
import { parseSvg, type ParsedSvg, type SvgLayer } from "./svg-parser";
import { memoStage } from "./pipeline";
import { countDuplicates, repair, type RepairParams, type RepairReport } from "./repair";
import { analyse, seams, type Problems, type Seam } from "./analysis";
import { writeStep, type CurveMode, type OutputUnit, type Region } from "./step-writer";

export type OutputGeometry = "curves" | "faces" | "both";
export type SizeSource = "document" | "pixels" | "unit-mm";
export type OriginMode = "svg" | "bottom-left" | "center";

export type ConvertOptions = {
  output: OutputGeometry;
  curveMode: CurveMode;
  tolerance: number; // output units
  exactEllipses: boolean;
  unit: OutputUnit;
  sizeSource: SizeSource;
  dpi: number;
  scale: number;
  origin: OriginMode;
  includeHidden: boolean;
  // Repair (output units). All geometry modifiers default to off, so the default output is
  // exactly the uploaded geometry.
  closeGaps: boolean;
  gapTolerance: number;
  removeDuplicates: boolean;
  minFeatureSize: number;
};

export const DEFAULT_OPTIONS: ConvertOptions = {
  output: "curves",
  curveMode: "spline",
  tolerance: 0.01,
  exactEllipses: true,
  unit: "mm",
  sizeSource: "document",
  dpi: 96,
  scale: 1,
  origin: "bottom-left",
  includeHidden: false,
  closeGaps: false,
  gapTolerance: 0.05,
  removeDuplicates: false,
  minFeatureSize: 0,
};

/** Settings that change the geometry itself; "Reset geometry" turns all of them off. */
export const GEOMETRY_MODIFIERS = {
  closeGaps: false,
  removeDuplicates: false,
  minFeatureSize: 0,
} satisfies Partial<ConvertOptions>;

export type Prepared = {
  shapes: Shape[]; // final CAD coordinates (Y up), output units
  regions: Region[];
  bounds: Bounds | null;
  openCount: number;
  closedCount: number;
  warnings: string[];
  unitsPerUserUnit: number;
  sizeNote: string;
  /** SVG path data for previewing the final geometry (Y flipped back for display). */
  previewPaths: { d: string; closed: boolean }[];
  /** Output geometry sampled as it will be exported, in output units (Y up). */
  polylines: { pts: Pt[]; closed: boolean }[];
  /** Face outlines and holes for filled previews, matching `regions`. */
  regionPolys: { outer: Pt[]; holes: Pt[][] }[];
  /** Top-level groups found in the SVG. */
  layers: SvgLayer[];
  problems: Problems;
  repairs: RepairReport;
  /** Start point and direction of every closed curve, for the seam overlay. */
  seams: Seam[];
};

const MM_PER_UNIT: Record<OutputUnit, number> = { mm: 1, in: 25.4 };

const repairStage = memoStage((shapes: Shape[], p: RepairParams & { extent: number }) =>
  repair(shapes, p, p.extent)
);

const parseStage = memoStage((markup: string, p: { includeHidden: boolean; exactEllipses: boolean }): ParsedSvg => {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  return parseSvg(doc, p);
});

/** Scale into output units and flip Y so the drawing reads upright in CAD. */
const placeStage = memoStage(
  (parsed: ParsedSvg, p: { k: number; vbx: number; vby: number }): Shape[] => {
    const m: Mat = [p.k, 0, 0, -p.k, -p.vbx * p.k, p.vby * p.k];
    return parsed.shapes.map((s) => transformShape(s, m));
  }
);

function userUnitToMm(parsed: ParsedSvg, opts: ConvertOptions): { mm: number; note: string } {
  const pxMm = 25.4 / opts.dpi;
  if (opts.sizeSource === "unit-mm") return { mm: 1, note: "1 SVG unit = 1 mm" };
  if (opts.sizeSource === "pixels") return { mm: pxMm, note: `1 SVG unit = 1 px at ${opts.dpi} DPI` };

  const { info } = parsed;
  const vb = info.viewBox;
  // Width/height given in px or unitless count as CSS pixels at the chosen DPI.
  const cssMm = (attr: string | null) => {
    const m = attr && /^\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(px)?\s*$/i.exec(attr);
    return m ? parseFloat(m[1]) * pxMm : null;
  };
  const wMm = info.widthMm ?? cssMm(info.widthAttr);
  const hMm = info.heightMm ?? cssMm(info.heightAttr);
  if (vb && (wMm || hMm)) {
    const sx = wMm ? wMm / vb[2] : Infinity;
    const sy = hMm ? hMm / vb[3] : Infinity;
    const s = Math.min(sx, sy);
    const abs = info.widthMm !== null || info.heightMm !== null;
    return {
      mm: s,
      note: abs
        ? `Document size ${info.widthAttr ?? "?"} × ${info.heightAttr ?? "?"}`
        : `Document size in px at ${opts.dpi} DPI`,
    };
  }
  return { mm: pxMm, note: `No absolute size, so units are px at ${opts.dpi} DPI` };
}

/**
 * Even-odd nesting: shapes inside an even number of others are outer boundaries,
 * shapes inside an odd number are holes in their immediate container.
 */
function nesting(polys: Pt[][]): { depth: number[]; parent: number[] } {
  const areas = polys.map((p) => Math.abs(signedArea(p)));
  const parent: number[] = polys.map(() => -1);
  const depth: number[] = polys.map(() => 0);
  const order = polys.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
  for (const i of order) {
    const probe = polys[i][0];
    let best = -1;
    for (const j of order) {
      if (j === i || areas[j] <= areas[i]) continue;
      if (pointInPolygon(probe, polys[j]) && (best === -1 || areas[j] < areas[best])) best = j;
    }
    parent[i] = best;
    depth[i] = best === -1 ? 0 : depth[best] + 1;
  }
  return { depth, parent };
}

/** Group closed shapes (by index into the full shape list) into outer boundaries and holes. */
function buildRegions(closed: number[], depth: number[], parent: number[]): { outer: number; holes: number[] }[] {
  const regions = new Map<number, { outer: number; holes: number[] }>();
  closed.forEach((shapeIdx, n) => {
    if (depth[n] % 2 === 0) regions.set(n, { outer: shapeIdx, holes: [] });
  });
  closed.forEach((shapeIdx, n) => {
    if (depth[n] % 2 === 1) regions.get(parent[n])?.holes.push(shapeIdx);
  });
  return [...regions.values()];
}

function toPathD(poly: Pt[], closed: boolean): string {
  if (!poly.length) return "";
  const f = (n: number) => +n.toFixed(4);
  let d = `M${f(poly[0].x)} ${f(-poly[0].y)}`;
  for (let i = 1; i < poly.length; i++) d += `L${f(poly[i].x)} ${f(-poly[i].y)}`;
  return closed ? d + "Z" : d;
}

export function prepare(markup: string, opts: ConvertOptions): Prepared {
  const parsed = parseStage(markup, { includeHidden: opts.includeHidden, exactEllipses: opts.exactEllipses });
  const { mm, note } = userUnitToMm(parsed, opts);
  const vb = parsed.info.viewBox;
  const k = (mm * opts.scale) / MM_PER_UNIT[opts.unit];
  const placed = placeStage(parsed, { k, vbx: vb?.[0] ?? 0, vby: vb?.[1] ?? 0 });
  const rough = boundsOf(placed.map((s) => flatten(s, Infinity)));
  const extent = rough ? Math.max(rough.maxX - rough.minX, rough.maxY - rough.minY, 1e-9) : 1;

  const repaired = repairStage(placed, {
    closeGaps: opts.closeGaps,
    gapTolerance: opts.gapTolerance,
    removeDuplicates: opts.removeDuplicates,
    minFeatureSize: opts.minFeatureSize,
    extent,
  });
  let shapes = repaired.shapes;
  let m: Mat = [1, 0, 0, 1, 0, 0];

  const previewTol = 0.0004;
  const measure = (list: Shape[]) => {
    const rough = boundsOf(list.map((s) => flatten(s, Infinity)));
    const extent = rough ? Math.max(rough.maxX - rough.minX, rough.maxY - rough.minY, 1e-6) : 1;
    return boundsOf(list.map((s) => flatten(s, extent * 1e-4)));
  };
  let bounds = measure(shapes);
  if (bounds && opts.origin !== "svg") {
    const dx = opts.origin === "center" ? -(bounds.minX + bounds.maxX) / 2 : -bounds.minX;
    const dy = opts.origin === "center" ? -(bounds.minY + bounds.maxY) / 2 : -bounds.minY;
    m = [1, 0, 0, 1, dx, dy];
    shapes = shapes.map((s) => transformShape(s, m));
  }

  const size = (() => {
    const b = measure(shapes);
    return b ? Math.max(b.maxX - b.minX, b.maxY - b.minY) : 1;
  })();
  const tol = Math.max(size * previewTol, 1e-6);
  const polys = shapes.map((s) => flatten(s, tol));
  bounds = boundsOf(polys);

  const isClosed = (s: Shape) => s.type === "ellipse" || s.closed;
  const closedIdx = shapes.map((s, i) => (isClosed(s) ? i : -1)).filter((i) => i >= 0);
  const { depth, parent } = nesting(closedIdx.map((i) => polys[i]));
  shapes = shapes.slice(); // the orientation pass below replaces entries in place

  // Give closed curves a consistent direction (outer boundaries counter-clockwise, holes
  // clockwise) and keep each seam off sharp corners, which some CAD importers reject.
  closedIdx.forEach((shapeIdx, n) => {
    let s = shapes[shapeIdx];
    if (s.type !== "path") return;
    const ccw = signedArea(polys[shapeIdx]) > 0;
    if (ccw !== (depth[n] % 2 === 0)) s = reverseShape(s);
    shapes[shapeIdx] = smoothSeam(s as PathShape);
  });

  // Previews show what will be exported: the actual chords in polyline mode, and finely
  // sampled curves otherwise. Flattened after seam/direction fixes so vertices match.
  const shown = shapes.map((s) => flatten(s, opts.curveMode === "polyline" ? opts.tolerance : tol));

  const regionIdx = opts.output === "curves" ? [] : buildRegions(closedIdx, depth, parent);
  const regions: Region[] = regionIdx.map((r) => ({ outer: shapes[r.outer], holes: r.holes.map((h) => shapes[h]) }));

  const problems = analyse(shapes, polys, {
    gapHint: Math.max(extent * 0.005, opts.gapTolerance),
    checkGaps: !opts.closeGaps,
  });
  // Counted before seam fixes, which can split identical shapes at different points.
  problems.duplicateCurves = opts.removeDuplicates ? 0 : countDuplicates(repaired.shapes, extent);
  const originShift = { x: m[4], y: m[5] };
  const joins = repaired.report.joins.map((p) => ({ x: p.x + originShift.x, y: p.y + originShift.y }));

  const warnings = [...parsed.warnings];
  const openCount = shapes.length - closedIdx.length;
  if (opts.output !== "curves" && openCount > 0) {
    warnings.push(
      `${openCount} open path${openCount > 1 ? "s" : ""} can't form faces${
        opts.output === "both" ? " and will only be exported as curves" : " and will be left out"
      }.`
    );
  }

  return {
    shapes,
    regions,
    bounds,
    openCount,
    closedCount: closedIdx.length,
    warnings,
    unitsPerUserUnit: k,
    sizeNote: note,
    previewPaths: shapes.map((s, i) => ({ d: toPathD(shown[i], isClosed(s)), closed: isClosed(s) })),
    polylines: shapes.map((s, i) => ({ pts: shown[i], closed: isClosed(s) })),
    regionPolys: regionIdx.map((r) => ({ outer: shown[r.outer], holes: r.holes.map((h) => shown[h]) })),
    layers: parsed.layers,
    problems,
    repairs: { ...repaired.report, joins },
    seams: seams(shown, shapes.map(isClosed)),
  };
}

export function toStep(prepared: Prepared, opts: ConvertOptions, baseName: string): string {
  return writeStep({
    productName: baseName,
    fileName: `${baseName}.step`,
    unit: opts.unit,
    curveMode: opts.curveMode,
    tolerance: opts.tolerance,
    curves: opts.output === "faces" ? null : prepared.shapes,
    regions: opts.output === "curves" ? null : prepared.regions,
  });
}
