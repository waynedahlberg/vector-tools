// Geometry repair: close near-miss gaps, drop exact duplicates, and remove specks.
// All distances are in output units. Every step returns new shapes; inputs are never mutated.

import { reverseShape, type PathShape, type Pt, type Segment, type Shape } from "./geometry";

export type RepairParams = {
  closeGaps: boolean;
  gapTolerance: number;
  removeDuplicates: boolean;
  minFeatureSize: number; // 0 = keep everything
};

export type RepairReport = {
  /** Where open ends were snapped together (joins between paths and self-closures). */
  joins: Pt[];
  duplicates: number;
  specks: number;
};

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const endOf = (s: Segment) => (s.kind === "line" ? s.p1 : s.p3);

/** Control-point bounding box: a cheap, conservative bound for a shape's extent. */
export function roughSize(s: Shape): number {
  if (s.type === "ellipse") return 2 * Math.max(s.rx, s.ry);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of s.segments) {
    for (const p of g.kind === "line" ? [g.p0, g.p1] : [g.p0, g.p1, g.p2, g.p3]) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  return Math.max(maxX - minX, maxY - minY);
}

/** Move a path's first point (and its outgoing handle) by d. */
function shiftStart(segs: Segment[], d: Pt): Segment[] {
  const [f, ...rest] = segs;
  const p0 = { x: f.p0.x + d.x, y: f.p0.y + d.y };
  const first: Segment =
    f.kind === "line" ? { ...f, p0 } : { ...f, p0, p1: { x: f.p1.x + d.x, y: f.p1.y + d.y } };
  return [first, ...rest];
}

/** Move a path's last point (and its incoming handle) by d. */
function shiftEnd(segs: Segment[], d: Pt): Segment[] {
  const l = segs[segs.length - 1];
  const last: Segment =
    l.kind === "line"
      ? { ...l, p1: { x: l.p1.x + d.x, y: l.p1.y + d.y } }
      : { ...l, p2: { x: l.p2.x + d.x, y: l.p2.y + d.y }, p3: { x: l.p3.x + d.x, y: l.p3.y + d.y } };
  return [...segs.slice(0, -1), last];
}

/** Snap a nearly-closed path shut by meeting both ends at their midpoint. */
function closePath(s: PathShape): { shape: PathShape; at: Pt } {
  const a = s.segments[0].p0, b = endOf(s.segments[s.segments.length - 1]);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let segs = shiftStart(s.segments, { x: mid.x - a.x, y: mid.y - a.y });
  segs = shiftEnd(segs, { x: mid.x - b.x, y: mid.y - b.y });
  return { shape: { ...s, segments: segs, closed: true }, at: mid };
}

function closeGaps(shapes: Shape[], tol: number, joins: Pt[]): Shape[] {
  const out: Shape[] = [];
  let open: PathShape[] = [];
  for (const s of shapes) {
    if (s.type === "path" && !s.closed) open.push(s);
    else out.push(s);
  }

  const trySelfClose = (s: PathShape): PathShape => {
    const a = s.segments[0].p0, b = endOf(s.segments[s.segments.length - 1]);
    // Needs enough extent that closing doesn't collapse a tiny stub into a loop.
    if (dist(a, b) <= tol && roughSize(s) > 2 * tol) {
      const { shape, at } = closePath(s);
      joins.push(at);
      return shape;
    }
    return s;
  };

  open = open.map(trySelfClose).filter((s) => {
    if (s.closed) out.push(s);
    return !s.closed;
  });

  // Greedily join the closest pair of ends between different open paths until none are in range.
  for (;;) {
    let best: { i: number; j: number; d: number; flipI: boolean; flipJ: boolean } | null = null;
    for (let i = 0; i < open.length; i++) {
      const si = open[i].segments;
      const iStart = si[0].p0, iEnd = endOf(si[si.length - 1]);
      for (let j = i + 1; j < open.length; j++) {
        const sj = open[j].segments;
        const jStart = sj[0].p0, jEnd = endOf(sj[sj.length - 1]);
        // Candidate joins, expressed as "end of I meets start of J" after optional reversals.
        const options: [number, boolean, boolean][] = [
          [dist(iEnd, jStart), false, false],
          [dist(iEnd, jEnd), false, true],
          [dist(iStart, jStart), true, false],
          [dist(iStart, jEnd), true, true],
        ];
        for (const [d, flipI, flipJ] of options) {
          if (d <= tol && (!best || d < best.d)) best = { i, j, d, flipI, flipJ };
        }
      }
    }
    if (!best) break;
    const a = (best.flipI ? reverseShape(open[best.i]) : open[best.i]) as PathShape;
    const b = (best.flipJ ? reverseShape(open[best.j]) : open[best.j]) as PathShape;
    const pa = endOf(a.segments[a.segments.length - 1]), pb = b.segments[0].p0;
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    joins.push(mid);
    const merged: PathShape = trySelfClose({
      ...a,
      segments: [
        ...shiftEnd(a.segments, { x: mid.x - pa.x, y: mid.y - pa.y }),
        ...shiftStart(b.segments, { x: mid.x - pb.x, y: mid.y - pb.y }),
      ],
    });
    open = open.filter((_, k) => k !== best!.i && k !== best!.j);
    if (merged.closed) out.push(merged);
    else open.push(merged);
  }
  return [...out, ...open];
}

/** Order-independent geometric signature, so a reversed or re-seamed copy still matches. */
function signature(s: Shape, q: number): string {
  const r = (v: number) => Math.round(v / q);
  if (s.type === "ellipse") {
    // An ellipse's axis direction is only defined up to sign.
    const angle = ((Math.atan2(s.axis.y, s.axis.x) % Math.PI) + Math.PI) % Math.PI;
    return `e:${r(s.center.x)},${r(s.center.y)},${r(s.rx)},${r(s.ry)},${Math.round(angle * 1e4)}`;
  }
  const pts: string[] = [];
  for (const g of s.segments) {
    for (const p of g.kind === "line" ? [g.p0, g.p1] : [g.p0, g.p1, g.p2, g.p3]) pts.push(`${r(p.x)},${r(p.y)}`);
  }
  // Closed paths repeat their seam point; dedupe points so seam position doesn't matter.
  const uniq = s.closed ? [...new Set(pts)] : pts;
  return `p:${s.closed ? 1 : 0}:${s.segments.length}:${uniq.sort().join(";")}`;
}

export function repair(shapes: Shape[], p: RepairParams, extent: number): { shapes: Shape[]; report: RepairReport } {
  const report: RepairReport = { joins: [], duplicates: 0, specks: 0 };
  let out = shapes;

  if (p.closeGaps && p.gapTolerance > 0) out = closeGaps(out, p.gapTolerance, report.joins);

  if (p.removeDuplicates) {
    const q = Math.max(extent * 1e-7, 1e-9);
    const seen = new Set<string>();
    out = out.filter((s) => {
      const key = signature(s, q);
      if (seen.has(key)) {
        report.duplicates++;
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  if (p.minFeatureSize > 0) {
    out = out.filter((s) => {
      if (roughSize(s) >= p.minFeatureSize) return true;
      report.specks++;
      return false;
    });
  }

  return { shapes: out, report };
}

/** How many shapes are exact copies of an earlier one (for hints while removal is off). */
export function countDuplicates(shapes: Shape[], extent: number): number {
  const q = Math.max(extent * 1e-7, 1e-9);
  const seen = new Set<string>();
  let n = 0;
  for (const s of shapes) {
    const key = signature(s, q);
    if (seen.has(key)) n++;
    else seen.add(key);
  }
  return n;
}
