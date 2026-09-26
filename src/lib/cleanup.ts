// Curve cleanup: refit Bézier paths with fewer nodes, within a tolerance. Corners (sharper than
// the corner angle) stay corners, straight lines stay lines, and exact circles/ellipses are left
// alone. A path is only replaced when the result has fewer segments than the original.

import { fitCubics } from "./fit";
import type { PathShape, Pt, Segment, Shape } from "./geometry";

export type CleanupParams = { tolerance: number; cornerAngle: number };
export type CleanupReport = { nodesBefore: number; nodesAfter: number; maxDeviation: number; tolerance: number };

type Cubic = Extract<Segment, { kind: "cubic" }>;

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const norm = (a: Pt): Pt | null => {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : null;
};
const endOf = (s: Segment) => (s.kind === "line" ? s.p1 : s.p3);

function tangentOut(s: Segment): Pt {
  if (s.kind === "line") return norm(sub(s.p1, s.p0)) ?? { x: 1, y: 0 };
  return norm(sub(s.p1, s.p0)) ?? norm(sub(s.p2, s.p0)) ?? norm(sub(s.p3, s.p0)) ?? { x: 1, y: 0 };
}

function tangentIn(s: Segment): Pt {
  if (s.kind === "line") return norm(sub(s.p1, s.p0)) ?? { x: 1, y: 0 };
  return norm(sub(s.p3, s.p2)) ?? norm(sub(s.p3, s.p1)) ?? norm(sub(s.p3, s.p0)) ?? { x: 1, y: 0 };
}

const turnDeg = (a: Pt, b: Pt) => (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y))) * 180) / Math.PI;

function cubicAt(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return { x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x, y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y };
}

/** Dense samples along a run of cubics, so the fit can be checked against the original shape. */
function sample(run: Cubic[], tol: number): Pt[] {
  const pts: Pt[] = [run[0].p0];
  for (const c of run) {
    const dd = Math.max(
      Math.hypot(c.p0.x - 2 * c.p1.x + c.p2.x, c.p0.y - 2 * c.p1.y + c.p2.y),
      Math.hypot(c.p1.x - 2 * c.p2.x + c.p3.x, c.p1.y - 2 * c.p2.y + c.p3.y)
    );
    const n = Math.max(6, Math.min(200, Math.ceil(Math.sqrt((0.75 * dd) / (tol * 0.1)))));
    for (let k = 1; k <= n; k++) pts.push(cubicAt(c, k / n));
  }
  return pts;
}

/** Ramer–Douglas–Peucker on a chain of line vertices. */
function rdp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const d = norm(sub(b, a));
  let worst = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const v = sub(pts[i], a);
    const off = d ? Math.abs(v.x * d.y - v.y * d.x) : Math.hypot(v.x, v.y);
    if (off > worst) {
      worst = off;
      idx = i;
    }
  }
  if (worst <= tol) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), tol).slice(0, -1), ...rdp(pts.slice(idx), tol)];
}

function cleanPath(s: PathShape, p: CleanupParams): { shape: PathShape; deviation: number } {
  let segs = s.segments;
  const n = segs.length;
  // Junction i sits between segment i-1 and segment i (junction 0 is the seam of a closed path).
  const isBreak = (i: number) => {
    const a = segs[(i - 1 + n) % n], b = segs[i % n];
    return a.kind === "line" || b.kind === "line" || turnDeg(tangentIn(a), tangentOut(b)) > p.cornerAngle;
  };

  if (s.closed) {
    // Start the loop at a break so no run wraps around the seam.
    const first = segs.findIndex((_, i) => isBreak(i));
    if (first > 0) segs = [...segs.slice(first), ...segs.slice(0, first)];
  }

  const runs: Segment[][] = [];
  let current: Segment[] = [];
  segs.forEach((seg, i) => {
    const prev = current[current.length - 1];
    const breakHere =
      prev &&
      (prev.kind !== seg.kind || (seg.kind === "cubic" && turnDeg(tangentIn(prev), tangentOut(seg)) > p.cornerAngle));
    if (i > 0 && breakHere) {
      runs.push(current);
      current = [];
    }
    current.push(seg);
  });
  if (current.length) runs.push(current);

  const out: Segment[] = [];
  let deviation = 0;
  for (const run of runs) {
    if (run[0].kind === "line") {
      const verts = [run[0].p0, ...run.map(endOf)];
      const kept = rdp(verts, p.tolerance);
      for (let i = 1; i < kept.length; i++) out.push({ kind: "line", p0: kept[i - 1], p1: kept[i] });
      continue;
    }
    const cubics = run as Cubic[];
    const pts = sample(cubics, p.tolerance);
    const t1 = tangentOut(cubics[0]);
    const tEnd = tangentIn(cubics[cubics.length - 1]);
    const fit = fitCubics(pts, t1, { x: -tEnd.x, y: -tEnd.y }, p.tolerance);
    if (fit.segments.length < cubics.length) {
      out.push(...fit.segments);
      deviation = Math.max(deviation, fit.maxError);
    } else {
      out.push(...cubics);
    }
  }
  return { shape: { ...s, segments: out }, deviation };
}

export function cleanupCurves(shapes: Shape[], p: CleanupParams): { shapes: Shape[]; report: CleanupReport } {
  let before = 0, after = 0, deviation = 0;
  const out = shapes.map((s) => {
    if (s.type !== "path") return s;
    before += s.segments.length;
    const { shape, deviation: d } = cleanPath(s, p);
    after += shape.segments.length;
    deviation = Math.max(deviation, d);
    return shape;
  });
  return { shapes: out, report: { nodesBefore: before, nodesAfter: after, maxDeviation: deviation, tolerance: p.tolerance } };
}

/** Maps the 0–100 strength slider to a tolerance: 0.001% to 0.5% of the drawing's size. */
export function cleanupTolerance(strength: number, extent: number): number {
  const s = Math.min(100, Math.max(0, strength)) / 100;
  return extent * 10 ** (-5 + 2.7 * s);
}
