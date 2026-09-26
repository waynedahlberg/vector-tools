// Core 2D geometry types and helpers shared by the SVG parser and STEP writer.

export type Pt = { x: number; y: number };

/** Affine matrix in SVG order: [a, b, c, d, e, f] → x' = a*x + c*y + e, y' = b*x + d*y + f */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export type Segment =
  | { kind: "line"; p0: Pt; p1: Pt }
  | { kind: "cubic"; p0: Pt; p1: Pt; p2: Pt; p3: Pt };

/** A connected run of segments (one SVG subpath). */
export type PathShape = {
  type: "path";
  name: string;
  segments: Segment[];
  closed: boolean;
};

/** An exact ellipse: center + two perpendicular semi-axes. `rx` lies along `axis`. */
export type EllipseShape = {
  type: "ellipse";
  name: string;
  center: Pt;
  axis: Pt; // unit vector of the rx direction
  rx: number;
  ry: number;
};

export type Shape = PathShape | EllipseShape;

export function transformShape(s: Shape, m: Mat): Shape {
  if (s.type === "path") {
    return {
      ...s,
      segments: s.segments.map((seg) =>
        seg.kind === "line"
          ? { kind: "line", p0: apply(m, seg.p0), p1: apply(m, seg.p1) }
          : {
              kind: "cubic",
              p0: apply(m, seg.p0),
              p1: apply(m, seg.p1),
              p2: apply(m, seg.p2),
              p3: apply(m, seg.p3),
            }
      ),
    };
  }
  // An affine map sends an ellipse to an ellipse. Build the 2x2 matrix that maps the
  // unit circle onto the transformed ellipse, then recover its axes from M·Mᵀ.
  const ax = s.axis;
  const bx: Pt = { x: -ax.y, y: ax.x };
  const L = (p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y });
  const c1 = L({ x: ax.x * s.rx, y: ax.y * s.rx });
  const c2 = L({ x: bx.x * s.ry, y: bx.y * s.ry });
  const a = c1.x * c1.x + c2.x * c2.x;
  const b = c1.x * c1.y + c2.x * c2.y;
  const d = c1.y * c1.y + c2.y * c2.y;
  const mean = (a + d) / 2;
  const diff = Math.sqrt(((a - d) / 2) ** 2 + b * b);
  const theta = 0.5 * Math.atan2(2 * b, a - d);
  return {
    type: "ellipse",
    name: s.name,
    center: apply(m, s.center),
    axis: { x: Math.cos(theta), y: Math.sin(theta) },
    rx: Math.sqrt(Math.max(mean + diff, 0)),
    ry: Math.sqrt(Math.max(mean - diff, 0)),
  };
}

/** Flatten a shape to a polyline within `tol`. Closed shapes repeat the first point at the end. */
export function flatten(s: Shape, tol: number): Pt[] {
  if (s.type === "ellipse") {
    const r = Math.max(s.rx, s.ry);
    const step = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI / 2;
    const n = Math.max(8, Math.min(2048, Math.ceil((2 * Math.PI) / step)));
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) pts.push(ellipsePoint(s, (i / n) * 2 * Math.PI));
    return pts;
  }
  const pts: Pt[] = [];
  s.segments.forEach((seg, i) => {
    if (i === 0) pts.push(seg.p0);
    if (seg.kind === "line") {
      pts.push(seg.p1);
      return;
    }
    // Wang's formula: segment count that keeps a cubic within tol of its chords.
    const dd = Math.max(
      Math.hypot(seg.p0.x - 2 * seg.p1.x + seg.p2.x, seg.p0.y - 2 * seg.p1.y + seg.p2.y),
      Math.hypot(seg.p1.x - 2 * seg.p2.x + seg.p3.x, seg.p1.y - 2 * seg.p2.y + seg.p3.y)
    );
    const n = Math.max(1, Math.min(512, Math.ceil(Math.sqrt((0.75 * dd) / tol))));
    for (let k = 1; k <= n; k++) pts.push(cubicPoint(seg, k / n));
  });
  return pts;
}

export function ellipsePoint(s: EllipseShape, t: number): Pt {
  const c = Math.cos(t) * s.rx;
  const d = Math.sin(t) * s.ry;
  return {
    x: s.center.x + s.axis.x * c - s.axis.y * d,
    y: s.center.y + s.axis.y * c + s.axis.x * d,
  };
}

function cubicPoint(s: Extract<Segment, { kind: "cubic" }>, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * s.p0.x + b * s.p1.x + c * s.p2.x + d * s.p3.x,
    y: a * s.p0.y + b * s.p1.y + c * s.p2.y + d * s.p3.y,
  };
}

export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function boundsOf(polys: Pt[][]): Bounds | null {
  let b: Bounds | null = null;
  for (const poly of polys) {
    for (const p of poly) {
      if (!b) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
      else {
        if (p.x < b.minX) b.minX = p.x;
        if (p.y < b.minY) b.minY = p.y;
        if (p.x > b.maxX) b.maxX = p.x;
        if (p.y > b.maxY) b.maxY = p.y;
      }
    }
  }
  return b;
}

// ---------------------------------------------------------------------------
// Closed-path normalisation
// ---------------------------------------------------------------------------

function segEnd(s: Segment): Pt {
  return s.kind === "line" ? s.p1 : s.p3;
}

function dir(a: Pt, b: Pt): Pt | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len > 1e-12 ? { x: dx / len, y: dy / len } : null;
}

/** Unit tangent leaving the segment's start, skipping zero-length handles. */
function startTangent(s: Segment): Pt | null {
  if (s.kind === "line") return dir(s.p0, s.p1);
  return dir(s.p0, s.p1) ?? dir(s.p0, s.p2) ?? dir(s.p0, s.p3);
}

/** Unit tangent arriving at the segment's end, skipping zero-length handles. */
function endTangent(s: Segment): Pt | null {
  if (s.kind === "line") return dir(s.p0, s.p1);
  return dir(s.p2, s.p3) ?? dir(s.p1, s.p3) ?? dir(s.p0, s.p3);
}

function splitSegment(s: Segment): [Segment, Segment] {
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  if (s.kind === "line") {
    const m = mid(s.p0, s.p1);
    return [{ kind: "line", p0: s.p0, p1: m }, { kind: "line", p0: m, p1: s.p1 }];
  }
  // de Casteljau at t = 0.5
  const a = mid(s.p0, s.p1), b = mid(s.p1, s.p2), c = mid(s.p2, s.p3);
  const d = mid(a, b), e = mid(b, c), m = mid(d, e);
  return [
    { kind: "cubic", p0: s.p0, p1: a, p2: d, p3: m },
    { kind: "cubic", p0: m, p1: e, p2: c, p3: s.p3 },
  ];
}

/**
 * Some CAD importers (Plasticity among them) discard a closed curve whose start/end
 * point sits on a sharp corner. If the seam is a corner, move it to the middle of the
 * longest segment, where the curve is always smooth. The geometry is unchanged.
 */
export function smoothSeam(s: PathShape): PathShape {
  if (!s.closed || s.segments.length === 0) return s;
  const tIn = endTangent(s.segments[s.segments.length - 1]);
  const tOut = startTangent(s.segments[0]);
  if (tIn && tOut && tIn.x * tOut.x + tIn.y * tOut.y > Math.cos((0.5 * Math.PI) / 180)) return s;

  let k = 0, best = -1;
  s.segments.forEach((seg, i) => {
    const len = Math.hypot(segEnd(seg).x - seg.p0.x, segEnd(seg).y - seg.p0.y);
    if (len > best) {
      best = len;
      k = i;
    }
  });
  const [first, second] = splitSegment(s.segments[k]);
  return {
    ...s,
    segments: [second, ...s.segments.slice(k + 1), ...s.segments.slice(0, k), first],
  };
}

export function reverseShape(s: Shape): Shape {
  if (s.type === "ellipse") return s; // STEP circles/ellipses are always parameterised CCW
  return {
    ...s,
    segments: s.segments
      .slice()
      .reverse()
      .map((g) =>
        g.kind === "line"
          ? { kind: "line", p0: g.p1, p1: g.p0 }
          : { kind: "cubic", p0: g.p3, p1: g.p2, p2: g.p1, p3: g.p0 }
      ),
  };
}
