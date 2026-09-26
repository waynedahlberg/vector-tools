// Finds geometry that tends to cause trouble in CAD: open ends, self-intersections, and gaps
// small enough that they were probably meant to be closed.

import type { Pt, Shape } from "./geometry";

export type Problems = {
  openEnds: Pt[];
  selfIntersections: Pt[];
  selfIntersectingCurves: number;
  /** Pairs of open ends closer than `gapHint` (only reported while gap closing is off). */
  nearGaps: number;
  gapHint: number;
  duplicateCurves: number;
};

export type Seam = { at: Pt; dir: Pt };

const MAX_POINTS_PER_CURVE = 3000;
const MAX_MARKERS = 400;

function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-18) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

/** Crossings between non-adjacent edges of one polyline, using a uniform grid to prune pairs. */
export function selfIntersections(poly: Pt[], closed: boolean): Pt[] {
  let pts = poly;
  if (pts.length > MAX_POINTS_PER_CURVE) {
    const step = Math.ceil(pts.length / MAX_POINTS_PER_CURVE);
    pts = pts.filter((_, i) => i % step === 0 || i === poly.length - 1);
  }
  const n = pts.length - 1; // edge count
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const cells = Math.max(1, Math.ceil(Math.sqrt(n)));
  const cw = (maxX - minX) / cells || 1, ch = (maxY - minY) / cells || 1;
  const grid = new Map<number, number[]>();
  const cell = (x: number, y: number) =>
    [Math.min(cells - 1, Math.floor((x - minX) / cw)), Math.min(cells - 1, Math.floor((y - minY) / ch))];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = cell(Math.min(pts[i].x, pts[i + 1].x), Math.min(pts[i].y, pts[i + 1].y));
    const [x1, y1] = cell(Math.max(pts[i].x, pts[i + 1].x), Math.max(pts[i].y, pts[i + 1].y));
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const k = gy * cells + gx;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
    }
  }
  const hits: Pt[] = [];
  const tested = new Set<number>();
  for (const list of grid.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = Math.min(list[a], list[b]), j = Math.max(list[a], list[b]);
        if (j - i < 2 || (closed && i === 0 && j === n - 1)) continue; // adjacent edges share a point
        const key = i * n + j;
        if (tested.has(key)) continue;
        tested.add(key);
        const p = segIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1]);
        if (p) hits.push(p);
      }
    }
  }
  return hits;
}

export function analyse(
  shapes: Shape[],
  polys: Pt[][],
  opts: { gapHint: number; checkGaps: boolean }
): Problems {
  const openEnds: Pt[] = [];
  const selfHits: Pt[] = [];
  let selfCurves = 0;
  const ends: Pt[] = [];

  shapes.forEach((s, i) => {
    const poly = polys[i];
    const closed = s.type === "ellipse" || s.closed;
    if (!closed && poly.length) {
      openEnds.push(poly[0], poly[poly.length - 1]);
      ends.push(poly[0], poly[poly.length - 1]);
    }
    if (s.type === "path") {
      const hits = selfIntersections(poly, closed);
      if (hits.length) {
        selfCurves++;
        selfHits.push(...hits.slice(0, 20));
      }
    }
  });

  let nearGaps = 0;
  if (opts.checkGaps && ends.length && ends.length <= 4000) {
    // Each open path contributes two consecutive ends; count distinct end pairs within range.
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const sameCurve = (i >> 1) === (j >> 1);
        const d = Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y);
        if (d <= opts.gapHint && (!sameCurve || d > 0)) nearGaps++;
      }
    }
  }

  return {
    openEnds: openEnds.slice(0, MAX_MARKERS),
    selfIntersections: selfHits.slice(0, MAX_MARKERS),
    selfIntersectingCurves: selfCurves,
    nearGaps,
    gapHint: opts.gapHint,
    duplicateCurves: 0,
  };
}

/** Start point and initial direction of each closed curve, for the seam/direction overlay. */
export function seams(polys: Pt[][], closedFlags: boolean[]): Seam[] {
  const out: Seam[] = [];
  polys.forEach((poly, i) => {
    if (!closedFlags[i] || poly.length < 2) return;
    const a = poly[0];
    const b = poly.find((p) => Math.hypot(p.x - a.x, p.y - a.y) > 1e-9) ?? poly[1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    out.push({ at: a, dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } });
  });
  return out;
}
