// Node reduction for traced paths. VTracer fits many short curves, especially on enlarged
// images; this refits each smooth run with as few cubics as fit within a tolerance, using the
// same curve cleanup as SVG → STEP. Corners stay corners. Pixel-mode traces are left alone.

import { cleanupCurves } from "../cleanup";
import type { PathShape, Pt, Segment } from "../geometry";
import type { Subpath, TraceResult } from "./settings";

const META: PathShape["meta"] = {
  id: "",
  layer: "",
  fill: "none",
  stroke: "none",
  strokeWidth: 0,
  linecap: "butt",
  linejoin: "miter",
  miterLimit: 4,
};

/** Maps the 0–100 slider to a tolerance in traced pixels, scaled up with any enlargement. */
export function simplifyTolerance(strength: number, upscale: number): number {
  const s = Math.min(100, Math.max(0, strength)) / 100;
  return (0.15 + 2.35 * s * s) * Math.max(1, upscale);
}

const pt = (p: number[], i: number): Pt => ({ x: p[2 * i], y: p[2 * i + 1] });

function toShape(s: Subpath): PathShape {
  const n = s.points.length / 2;
  const segments: Segment[] = [];
  if (s.kind === "cubic") {
    for (let i = 0; i + 3 < n; i += 3) {
      segments.push({ kind: "cubic", p0: pt(s.points, i), p1: pt(s.points, i + 1), p2: pt(s.points, i + 2), p3: pt(s.points, i + 3) });
    }
  } else {
    for (let i = 0; i < n; i++) segments.push({ kind: "line", p0: pt(s.points, i), p1: pt(s.points, (i + 1) % n) });
  }
  return { type: "path", name: "", meta: META, segments, closed: true };
}

function fromShape(shape: PathShape, kind: Subpath["kind"]): Subpath {
  const segs = shape.segments;
  if (kind === "polygon") return { kind, points: segs.flatMap((s) => [s.p0.x, s.p0.y]) };
  // Lines become straight cubics, so a subpath stays one kind.
  const points = [segs[0].p0.x, segs[0].p0.y];
  for (const s of segs) {
    if (s.kind === "cubic") {
      points.push(s.p1.x, s.p1.y, s.p2.x, s.p2.y, s.p3.x, s.p3.y);
    } else {
      const dx = s.p1.x - s.p0.x;
      const dy = s.p1.y - s.p0.y;
      points.push(s.p0.x + dx / 3, s.p0.y + dy / 3, s.p0.x + (2 * dx) / 3, s.p0.y + (2 * dy) / 3, s.p1.x, s.p1.y);
    }
  }
  return { kind, points };
}

type Line = Extract<Segment, { kind: "line" }>;
type Cubic = Extract<Segment, { kind: "cubic" }>;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function offLine(p: Pt, a: Pt, b: Pt): number {
  const l = dist(a, b);
  if (l < 1e-9) return dist(p, a);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l;
}

/** VTracer writes straight edges as flat cubics; make them lines so they merge into one. */
function lineify(segs: Segment[], tol: number): Segment[] {
  return segs.map((s) =>
    s.kind === "cubic" && offLine(s.p1, s.p0, s.p3) <= tol * 0.5 && offLine(s.p2, s.p0, s.p3) <= tol * 0.5
      ? { kind: "line", p0: s.p0, p1: s.p3 }
      : s
  );
}

function intersect(a: Line, b: Line): Pt | null {
  const d1 = { x: a.p1.x - a.p0.x, y: a.p1.y - a.p0.y };
  const d2 = { x: b.p1.x - b.p0.x, y: b.p1.y - b.p0.y };
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.p0.x - a.p0.x) * d2.y - (b.p0.y - a.p0.y) * d2.x) / den;
  return { x: a.p0.x + d1.x * t, y: a.p0.y + d1.y * t };
}

const angleBetween = (a: Line, b: Line) => {
  const u = Math.atan2(a.p1.y - a.p0.y, a.p1.x - a.p0.x);
  const v = Math.atan2(b.p1.y - b.p0.y, b.p1.x - b.p0.x);
  const d = Math.abs(u - v) % (2 * Math.PI);
  return ((d > Math.PI ? 2 * Math.PI - d : d) * 180) / Math.PI;
};

/**
 * Tracing rounds every corner a little. Where a short curve joins two straight edges that
 * meet at a real corner, drop the curve and extend the edges to meet.
 */
function sharpenCorners(segs: Segment[], tol: number, cornerAngle: number): Segment[] {
  const out = [...segs];
  const maxRun = tol * 6;
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[i];
      if (a.kind !== "line") continue;
      // Collect the curves after `a` up to the next line, while they stay short.
      let j = (i + 1) % out.length;
      let length = 0;
      const run: number[] = [];
      while (out[j].kind === "cubic" && run.length < 3) {
        const c = out[j] as Cubic;
        length += dist(c.p0, c.p3);
        run.push(j);
        j = (j + 1) % out.length;
      }
      const b = out[j];
      if (!run.length || b.kind !== "line" || j === i || length > maxRun) continue;
      if (angleBetween(a, b) < Math.min(cornerAngle, 60)) continue;
      const corner = intersect(a, b);
      if (!corner || dist(corner, (out[run[0]] as Cubic).p0) > maxRun || dist(corner, b.p0) > maxRun) continue;
      out[i] = { kind: "line", p0: a.p0, p1: corner };
      out[j] = { kind: "line", p0: corner, p1: b.p1 };
      for (const k of [...run].sort((x, y) => y - x)) {
        out.splice(k, 1);
        if (k < i) i--;
      }
      changed = true;
    }
  }
  return out;
}

/**
 * Returns a copy of `result` with fewer nodes. Each subpath is only replaced when the refit is
 * smaller, so this never adds nodes.
 */
export function simplifyTrace(result: TraceResult, tolerance: number, cornerAngle: number): TraceResult {
  const params = { tolerance, cornerAngle: Math.max(10, Math.min(170, cornerAngle)) };
  let pointCount = 0;
  const layers = result.layers.map((layer) => ({
    ...layer,
    subpaths: layer.subpaths.map((s) => {
      const shape = toShape(s);
      let next = s;
      if (shape.segments.length >= 3) {
        const refit = (segments: Segment[]) => (cleanupCurves([{ ...shape, segments }], params).shapes[0] as PathShape).segments;
        let segments = refit(shape.segments);
        if (s.kind === "cubic") {
          // Straightening suits edges and corners but splits smooth curves into pieces, so
          // it's tried separately and kept only when it gives fewer segments.
          const straight = sharpenCorners(refit(lineify(shape.segments, tolerance)), tolerance, params.cornerAngle);
          if (straight.length <= segments.length) segments = straight;
        }
        if (segments.length >= 2 && segments.length < shape.segments.length) next = fromShape({ ...shape, segments }, s.kind);
      }
      pointCount += next.points.length / 2;
      return next;
    }),
  }));
  return { ...result, layers, pointCount };
}
