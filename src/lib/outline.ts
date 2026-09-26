// Stroke to outline: offset stroke-only shapes by half their stroke width with Clipper2, then
// fit the resulting polygons back into lines and smooth curves.

import { EndType, JoinType, inflatePathsD, type PathD } from "clipper2-ts";
import { fitPolyline } from "./fit";
import { flatten, type PathShape, type Shape, type ShapeMeta } from "./geometry";

const JOIN: Record<ShapeMeta["linejoin"], JoinType> = {
  miter: JoinType.Miter,
  round: JoinType.Round,
  bevel: JoinType.Bevel,
};
const CAP: Record<ShapeMeta["linecap"], EndType> = {
  butt: EndType.Butt,
  round: EndType.Round,
  square: EndType.Square,
};

export const isStrokeOnly = (s: Shape) =>
  s.meta.fill === "none" && s.meta.stroke !== "none" && s.meta.strokeWidth > 0;

export function outlineStrokes(
  shapes: Shape[],
  p: { extent: number; cornerAngle: number }
): { shapes: Shape[]; outlined: number } {
  // Clipper works on a fixed decimal precision; pick enough digits for the drawing's scale.
  const precision = Math.min(8, Math.max(2, Math.ceil(-Math.log10(p.extent * 1e-7))));
  let outlined = 0;
  const out: Shape[] = [];

  for (const s of shapes) {
    if (!isStrokeOnly(s)) {
      out.push(s);
      continue;
    }
    const w = s.meta.strokeWidth;
    const fitTol = Math.max(Math.min(w * 0.004, p.extent * 2e-5), p.extent * 1e-7);
    const closed = s.type === "ellipse" || s.closed;
    let poly = flatten(s, fitTol * 0.25);
    if (closed && poly.length > 1) poly = poly.slice(0, -1);
    if (poly.length < 2) {
      out.push(s);
      continue;
    }

    const paths: PathD[] = inflatePathsD(
      [poly.map((q) => ({ x: q.x, y: q.y }))],
      w / 2,
      JOIN[s.meta.linejoin],
      closed ? EndType.Joined : CAP[s.meta.linecap],
      s.meta.miterLimit,
      precision,
      w * 0.001
    );
    if (!paths.length) {
      out.push(s);
      continue;
    }
    outlined++;
    paths.forEach((path, k) => {
      const fit = fitPolyline(path, true, fitTol, p.cornerAngle);
      if (!fit.segments.length) return;
      const shape: PathShape = {
        type: "path",
        name: k === 0 ? s.name : `${s.name}.outline${k + 1}`,
        meta: { ...s.meta, id: `${s.meta.id}~outline${k}`, fill: s.meta.stroke, stroke: "none", strokeWidth: 0 },
        segments: fit.segments,
        closed: true,
      };
      out.push(shape);
    });
  }
  return { shapes: out, outlined };
}
