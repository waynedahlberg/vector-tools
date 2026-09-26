import {
  flatten,
  multiply,
  pointInPolygon,
  signedArea,
  reverseShape,
  smoothSeam,
  transformShape,
  unionBounds,
  type Bounds,
  type PathShape,
  type Mat,
  type Pt,
  type Shape,
} from "./geometry";
import { parseSvg, type ParsedSvg, type SvgLayer } from "./svg-parser";
import { memoStage } from "./pipeline";
import { displayColor } from "./paint";
import { countDuplicates, repair, type RepairParams, type RepairReport } from "./repair";
import { analyse, seams, type Problems, type Seam } from "./analysis";
import { isStrokeOnly, outlineStrokes } from "./outline";
import { cleanupCurves, cleanupTolerance, type CleanupParams, type CleanupReport } from "./cleanup";
import { writeStep, type CurveMode, type DrawingPlane, type OutputUnit, type Region } from "./step-writer";

export type OutputGeometry = "curves" | "faces" | "both";
export type SizeSource = "document" | "pixels" | "unit-mm";
export type OriginMode = "svg" | "bottom-left" | "center";
export type SizeMode = "scale" | "width" | "height";
export type Rotation = 0 | 90 | 180 | 270;

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
  // Shape: stroke-only shapes become closed outlines of their stroke; cleanup refits curves with
  // fewer nodes. Strength 0–100 maps to a tolerance relative to the drawing's size.
  outlineStrokes: boolean;
  cleanup: boolean;
  cleanupStrength: number;
  cornerAngle: number;
  // Transform. In width/height mode the drawing is scaled to `targetSize` (output units) and
  // `scale` is ignored. Rotation is counter-clockwise as seen in CAD.
  sizeMode: SizeMode;
  targetSize: number;
  rotation: Rotation;
  mirrorX: boolean;
  mirrorY: boolean;
  plane: DrawingPlane;
  // Selection (per file): layer keys and display colours to leave out.
  hiddenLayers: string[];
  hiddenColors: string[];
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
  outlineStrokes: false,
  cleanup: false,
  cleanupStrength: 40,
  cornerAngle: 30,
  sizeMode: "scale",
  targetSize: 100,
  rotation: 0,
  mirrorX: false,
  mirrorY: false,
  plane: "xy",
  hiddenLayers: [],
  hiddenColors: [],
};

/** Settings that change the geometry itself; "Reset geometry" turns all of them off. */
export const GEOMETRY_MODIFIERS = {
  closeGaps: false,
  outlineStrokes: false,
  cleanup: false,
  removeDuplicates: false,
  minFeatureSize: 0,
  hiddenLayers: [] as string[],
  hiddenColors: [] as string[],
} satisfies Partial<ConvertOptions>;

/** Settings that only make sense for the file they were chosen on. */
export const PER_FILE_OPTIONS = {
  hiddenLayers: [] as string[],
  hiddenColors: [] as string[],
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
  /** Top-level groups found in the SVG, with how many shapes each holds (before filtering). */
  layers: (SvgLayer & { count: number })[];
  /** Display colours found in the SVG (fill, or stroke when unfilled), most common first. */
  colors: { color: string; count: number }[];
  problems: Problems;
  repairs: RepairReport;
  /** Start point and direction of every closed curve, for the seam overlay. */
  seams: Seam[];
  /** Stroke-only shapes in the selection, and how many were turned into outlines. */
  strokeOnly: number;
  outlined: number;
  cleanup: CleanupReport | null;
  /** The geometry before outlining/cleanup, for a ghost overlay (empty when neither is on). */
  ghost: Pt[][];
};

const MM_PER_UNIT: Record<OutputUnit, number> = { mm: 1, in: 25.4 };

const repairStage = memoStage((shapes: Shape[], p: RepairParams & { extent: number }) =>
  repair(shapes, p, p.extent)
);

const outlineStage = memoStage((shapes: Shape[], p: { on: boolean; extent: number; cornerAngle: number }) =>
  p.on ? outlineStrokes(shapes, p) : { shapes, outlined: 0 }
);

const cleanupStage = memoStage((shapes: Shape[], p: { on: boolean } & CleanupParams) =>
  p.on ? cleanupCurves(shapes, p) : { shapes, report: null }
);

const parseStage = memoStage((markup: string, p: { includeHidden: boolean; exactEllipses: boolean }): ParsedSvg => {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  return parseSvg(doc, p);
});

const catalogStage = memoStage((parsed: ParsedSvg) => {
  const layerCounts = new Map<string, number>();
  const colorCounts = new Map<string, number>();
  for (const s of parsed.shapes) {
    layerCounts.set(s.meta.layer, (layerCounts.get(s.meta.layer) ?? 0) + 1);
    const c = displayColor(s.meta.fill, s.meta.stroke);
    colorCounts.set(c, (colorCounts.get(c) ?? 0) + 1);
  }
  return {
    layers: parsed.layers.map((l) => ({ ...l, count: layerCounts.get(l.id) ?? 0 })),
    colors: [...colorCounts].map(([color, count]) => ({ color, count })).sort((a, b) => b.count - a.count),
  };
});

/** Leave out hidden layers and colours. Returns the parsed array itself when nothing is hidden. */
const selectStage = memoStage((parsed: ParsedSvg, p: { hiddenLayers: string[]; hiddenColors: string[] }) => {
  if (!p.hiddenLayers.length && !p.hiddenColors.length) return parsed.shapes;
  const layers = new Set(p.hiddenLayers), colors = new Set(p.hiddenColors);
  return parsed.shapes.filter(
    (s) => !layers.has(s.meta.layer) && !colors.has(displayColor(s.meta.fill, s.meta.stroke))
  );
});

type PlaceParams = {
  k: number;
  vbx: number;
  vby: number;
  rotation: Rotation;
  mirrorX: boolean;
  mirrorY: boolean;
  sizeMode: SizeMode;
  targetSize: number;
};

/**
 * Scale into output units, flip Y so the drawing reads upright in CAD, then rotate/mirror and
 * fit to a target size. Everything downstream works in final output units.
 */
const placeStage = memoStage((shapes: Shape[], p: PlaceParams): { shapes: Shape[]; fit: number } => {
  const base: Mat = [p.k, 0, 0, -p.k, -p.vbx * p.k, p.vby * p.k];
  const r = (p.rotation * Math.PI) / 180;
  const c = Math.round(Math.cos(r)), s = Math.round(Math.sin(r)); // exact for quarter turns
  const mirror: Mat = [p.mirrorX ? -1 : 1, 0, 0, p.mirrorY ? -1 : 1, 0, 0];
  let out = shapes.map((sh) => transformShape(sh, multiply([c, s, -s, c, 0, 0], multiply(mirror, base))));

  let fit = 1;
  if (p.sizeMode !== "scale" && out.length) {
    const b = unionBounds(out)!;
    const current = p.sizeMode === "width" ? b.maxX - b.minX : b.maxY - b.minY;
    if (current > 1e-12 && p.targetSize > 0) {
      fit = p.targetSize / current;
      out = out.map((sh) => transformShape(sh, [fit, 0, 0, fit, 0, 0]));
    }
  }
  return { shapes: out, fit };
});

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
  const k = (mm * (opts.sizeMode === "scale" ? opts.scale : 1)) / MM_PER_UNIT[opts.unit];
  const selected = selectStage(parsed, { hiddenLayers: opts.hiddenLayers, hiddenColors: opts.hiddenColors });
  const { shapes: placed, fit } = placeStage(selected, {
    k,
    vbx: vb?.[0] ?? 0,
    vby: vb?.[1] ?? 0,
    rotation: opts.rotation,
    mirrorX: opts.mirrorX,
    mirrorY: opts.mirrorY,
    sizeMode: opts.sizeMode,
    targetSize: opts.targetSize,
  });
  const placedBounds = unionBounds(placed);
  const extent = placedBounds
    ? Math.max(placedBounds.maxX - placedBounds.minX, placedBounds.maxY - placedBounds.minY, 1e-9)
    : 1;

  const repaired = repairStage(placed, {
    closeGaps: opts.closeGaps,
    gapTolerance: opts.gapTolerance,
    removeDuplicates: opts.removeDuplicates,
    minFeatureSize: opts.minFeatureSize,
    extent,
  });
  const outlined = outlineStage(repaired.shapes, {
    on: opts.outlineStrokes,
    extent,
    cornerAngle: opts.cornerAngle,
  });
  const cleaned = cleanupStage(outlined.shapes, {
    on: opts.cleanup,
    tolerance: cleanupTolerance(opts.cleanupStrength, extent),
    cornerAngle: opts.cornerAngle,
  });
  let shapes = cleaned.shapes;
  const modified = cleaned.shapes !== repaired.shapes; // outline or cleanup changed something
  let m: Mat = [1, 0, 0, 1, 0, 0];

  const previewTol = 0.0004;
  let bounds = unionBounds(shapes);
  if (bounds && opts.origin !== "svg") {
    const dx = opts.origin === "center" ? -(bounds.minX + bounds.maxX) / 2 : -bounds.minX;
    const dy = opts.origin === "center" ? -(bounds.minY + bounds.maxY) / 2 : -bounds.minY;
    m = [1, 0, 0, 1, dx, dy];
    shapes = shapes.map((s) => transformShape(s, m));
    bounds = { minX: bounds.minX + dx, maxX: bounds.maxX + dx, minY: bounds.minY + dy, maxY: bounds.maxY + dy };
  }

  const size = bounds ? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) : 1;
  const tol = Math.max(size * previewTol, 1e-6);
  const polys = shapes.map((s) => flatten(s, tol));

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

  // The stroke-only notice suggests outlining; drop it once that's on.
  const warnings = parsed.warnings.filter((w) => !(opts.outlineStrokes && w.includes("stroke-only")));
  const ghost = modified ? repaired.shapes.map((sh) => flatten(transformShape(sh, m), tol)) : [];
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
    unitsPerUserUnit: k * fit,
    sizeNote: opts.sizeMode === "scale" ? note : `Scaled to ${+opts.targetSize.toPrecision(6)} ${opts.unit} ${opts.sizeMode}`,
    previewPaths: shapes.map((s, i) => ({ d: toPathD(shown[i], isClosed(s)), closed: isClosed(s) })),
    polylines: shapes.map((s, i) => ({ pts: shown[i], closed: isClosed(s) })),
    regionPolys: regionIdx.map((r) => ({ outer: shown[r.outer], holes: r.holes.map((h) => shown[h]) })),
    ...catalogStage(parsed, null),
    problems,
    repairs: { ...repaired.report, joins },
    seams: seams(shown, shapes.map(isClosed)),
    strokeOnly: repaired.shapes.filter(isStrokeOnly).length,
    outlined: outlined.outlined,
    cleanup: cleaned.report,
    ghost,
  };
}

export function toStep(prepared: Prepared, opts: ConvertOptions, baseName: string): string {
  return writeStep({
    productName: baseName,
    fileName: `${baseName}.step`,
    unit: opts.unit,
    curveMode: opts.curveMode,
    tolerance: opts.tolerance,
    plane: opts.plane,
    curves: opts.output === "faces" ? null : prepared.shapes,
    regions: opts.output === "curves" ? null : prepared.regions,
  });
}
