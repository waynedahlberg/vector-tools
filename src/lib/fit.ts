// Curve fitting after Philip J. Schneider, "An Algorithm for Automatically Fitting Digitized
// Curves" (Graphics Gems, 1990): least-squares cubic Béziers with fixed end tangents, Newton
// reparameterisation, and splitting at the worst point until every sample is within tolerance.

import type { Pt, Segment } from "./geometry";

type Cubic = Extract<Segment, { kind: "cubic" }>;

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const len = (a: Pt) => Math.hypot(a.x, a.y);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: Pt): Pt => {
  const l = len(a);
  return l > 1e-15 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

function bez(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
  };
}

function bezD1(c: Cubic, t: number): Pt {
  const u = 1 - t;
  return add(add(mul(sub(c.p1, c.p0), 3 * u * u), mul(sub(c.p2, c.p1), 6 * u * t)), mul(sub(c.p3, c.p2), 3 * t * t));
}

function bezD2(c: Cubic, t: number): Pt {
  const u = 1 - t;
  return add(mul(add(sub(c.p2, mul(c.p1, 2)), c.p0), 6 * u), mul(add(sub(c.p3, mul(c.p2, 2)), c.p1), 6 * t));
}

function chordParams(pts: Pt[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

/** Least-squares cubic through pts with end tangents t1 (outgoing) and t2 (pointing back). */
function generate(pts: Pt[], u: number[], t1: Pt, t2: Pt): Cubic {
  const first = pts[0], last = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], s = 1 - t;
    const b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let alpha1 = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0;
  let alpha2 = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
  const segLen = dist(first, last);
  const eps = 1e-6 * segLen;
  // Degenerate solutions fall back to Wu/Barsky's heuristic of a third of the chord.
  if (alpha1 < eps || alpha2 < eps || !Number.isFinite(alpha1) || !Number.isFinite(alpha2)) {
    alpha1 = alpha2 = segLen / 3;
  }
  return { kind: "cubic", p0: first, p1: add(first, mul(t1, alpha1)), p2: add(last, mul(t2, alpha2)), p3: last };
}

function reparameterise(c: Cubic, pts: Pt[], u: number[]): number[] {
  return u.map((t, i) => {
    const d = sub(bez(c, t), pts[i]);
    const d1 = bezD1(c, t), d2 = bezD2(c, t);
    const den = dot(d1, d1) + dot(d, d2);
    if (Math.abs(den) < 1e-18) return t;
    return Math.min(1, Math.max(0, t - dot(d, d1) / den));
  });
}

function maxError(c: Cubic, pts: Pt[], u: number[]): { error: number; split: number } {
  let error = 0, split = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(bez(c, u[i]), pts[i]);
    if (d > error) {
      error = d;
      split = i;
    }
  }
  return { error, split };
}

export type FitResult = { segments: Segment[]; maxError: number };

/** Fit cubic Béziers to an ordered run of points within `tol`, keeping the given end tangents. */
export function fitCubics(pts: Pt[], t1: Pt, t2: Pt, tol: number, depth = 0): FitResult {
  if (pts.length === 2 || depth > 40) {
    const l = dist(pts[0], pts[pts.length - 1]) / 3;
    const last = pts[pts.length - 1];
    return {
      segments: [{ kind: "cubic", p0: pts[0], p1: add(pts[0], mul(t1, l)), p2: add(last, mul(t2, l)), p3: last }],
      maxError: 0,
    };
  }
  let u = chordParams(pts);
  let curve = generate(pts, u, t1, t2);
  let { error, split } = maxError(curve, pts, u);
  if (error <= tol) return { segments: [curve], maxError: error };

  // Chord-length parameters are only a first guess; refine them with Newton steps before
  // resorting to a split, unless the single-curve fit is hopeless.
  if (error <= tol * 100) {
    for (let k = 0; k < 20; k++) {
      const prev = error;
      u = reparameterise(curve, pts, u);
      curve = generate(pts, u, t1, t2);
      ({ error, split } = maxError(curve, pts, u));
      if (error <= tol) return { segments: [curve], maxError: error };
      if (error > prev * 0.999) break; // stalled
    }
  }

  // Split at the worst point, sharing a tangent there so the join stays smooth.
  split = Math.min(Math.max(split, 1), pts.length - 2);
  const center = unit(sub(pts[split - 1], pts[split + 1]));
  const left = fitCubics(pts.slice(0, split + 1), t1, center, tol, depth + 1);
  const right = fitCubics(pts.slice(split), mul(center, -1), t2, tol, depth + 1);
  return { segments: [...left.segments, ...right.segments], maxError: Math.max(left.maxError, right.maxError) };
}

/** Tangent leaving pts[0], estimated from nearby points so noise doesn't dominate. */
function startTangent(pts: Pt[]): Pt {
  for (let i = 1; i < pts.length; i++) {
    const t = unit(sub(pts[i], pts[0]));
    if (len(t) > 0) return t;
  }
  return { x: 1, y: 0 };
}

const turnDeg = (a: Pt, b: Pt, c: Pt) => {
  const v1 = unit(sub(b, a)), v2 = unit(sub(c, b));
  return (Math.acos(Math.max(-1, Math.min(1, dot(v1, v2)))) * 180) / Math.PI;
};

/** Is every point of the run within tol of the straight line between its ends? */
function isStraight(pts: Pt[], tol: number): boolean {
  const a = pts[0], b = pts[pts.length - 1];
  const d = unit(sub(b, a));
  const l = dist(a, b);
  if (l < 1e-12) return false;
  return pts.every((p) => {
    const v = sub(p, a);
    const along = dot(v, d);
    return along >= -tol && along <= l + tol && Math.abs(v.x * d.y - v.y * d.x) <= tol;
  });
}

/**
 * Turn a dense polyline (e.g. an offset outline) into lines and smooth cubics. Sharp turns
 * become corners; long straight chords stay straight lines; everything else is fitted.
 */
export function fitPolyline(input: Pt[], closed: boolean, tol: number, cornerDeg: number): FitResult {
  let pts = input.filter((p, i) => i === 0 || dist(p, input[i - 1]) > tol * 1e-3);
  if (closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= tol * 1e-3) pts = pts.slice(0, -1);
  const n = pts.length;
  if (n < 2) return { segments: [], maxError: 0 };
  if (n === 2) return { segments: closed ? [] : [{ kind: "line", p0: pts[0], p1: pts[1] }], maxError: 0 };

  const at = (i: number) => pts[((i % n) + n) % n];
  const chord = (i: number) => dist(at(i), at(i + 1));
  // Break points: sharp corners, and both ends of chords much longer than their neighbours.
  const breaks = new Set<number>();
  const count = closed ? n : n - 1;
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    if (turnDeg(at(i - 1), at(i), at(i + 1)) > cornerDeg) breaks.add(i);
  }
  const straight = new Set<number>();
  for (let i = 0; i < count; i++) {
    const prev = closed || i > 0 ? chord(i - 1) : 0;
    const next = closed || i < count - 1 ? chord(i + 1) : 0;
    if (chord(i) > 3 * Math.max(prev, next, tol)) {
      straight.add(i);
      breaks.add(i);
      breaks.add((i + 1) % n);
    }
  }
  if (!closed) {
    breaks.add(0);
    breaks.add(n - 1);
  }

  // A closed loop with no breaks is one smooth run: start anywhere, matching tangents at the seam.
  if (closed && breaks.size === 0) {
    const loop = [...pts, pts[0]];
    const tan = unit(sub(pts[1], pts[n - 1]));
    return fitCubics(loop, tan, mul(tan, -1), tol);
  }

  const order = [...breaks].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (let k = 0; k < order.length; k++) {
    const from = order[k];
    let to = order[k + 1];
    if (to === undefined) {
      if (!closed) break;
      to = order[0] + n;
    }
    runs.push([from, to]);
  }

  const segments: Segment[] = [];
  let maxErr = 0;
  for (const [from, to] of runs) {
    const run: Pt[] = [];
    for (let i = from; i <= to; i++) run.push(at(i));
    if (to - from === 1 && straight.has(from % n)) {
      segments.push({ kind: "line", p0: run[0], p1: run[1] });
      continue;
    }
    if (isStraight(run, tol)) {
      segments.push({ kind: "line", p0: run[0], p1: run[run.length - 1] });
      continue;
    }
    const t1 = startTangent(run);
    const t2 = startTangent([...run].reverse());
    const fit = fitCubics(run, t1, t2, tol);
    maxErr = Math.max(maxErr, fit.maxError);
    segments.push(...fit.segments);
  }
  return { segments, maxError: maxErr };
}
