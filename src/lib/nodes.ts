// The nodes of the exported geometry, for the node overlay in the 3D preview: anchor points and
// Bézier handles for splines, or the exported vertices for polylines. Exact circles and ellipses
// have no nodes in STEP, so they contribute none.

import type { Pt, Shape } from "./geometry";

export type NodeSet = {
  anchors: Pt[];
  /** Handle lines from an anchor to its control point. */
  handles: [Pt, Pt][];
};

const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12;

export function splineNodes(shapes: Shape[]): NodeSet {
  const anchors: Pt[] = [];
  const handles: [Pt, Pt][] = [];
  for (const s of shapes) {
    if (s.type !== "path" || !s.segments.length) continue;
    for (const seg of s.segments) {
      anchors.push(seg.p0);
      if (seg.kind === "cubic") {
        if (!same(seg.p0, seg.p1)) handles.push([seg.p0, seg.p1]);
        if (!same(seg.p3, seg.p2)) handles.push([seg.p3, seg.p2]);
      }
    }
    // Closed paths end where they start; open ones have one more anchor at the end.
    if (!s.closed) {
      const last = s.segments[s.segments.length - 1];
      anchors.push(last.kind === "line" ? last.p1 : last.p3);
    }
  }
  return { anchors, handles };
}

/** Vertices of exported polylines (the closing point of a closed polyline isn't repeated). */
export function polylineNodes(polylines: { pts: Pt[]; closed: boolean }[]): NodeSet {
  const anchors: Pt[] = [];
  for (const pl of polylines) {
    const n = pl.closed && pl.pts.length > 1 && same(pl.pts[0], pl.pts[pl.pts.length - 1]) ? pl.pts.length - 1 : pl.pts.length;
    for (let i = 0; i < n; i++) anchors.push(pl.pts[i]);
  }
  return { anchors, handles: [] };
}
