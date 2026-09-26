import { describe, expect, it } from "vitest";
import { fitCubics, fitPolyline } from "@/lib/fit";
import { flatten, signedArea, type Pt, type Shape } from "@/lib/geometry";
import { ROCKET, area, run, seamTurn, stepEntities, svg } from "./helpers";

/** Largest distance from any point of `a` to the polyline `b` (one-sided Hausdorff). */
function deviation(a: Pt[], b: Pt[]): number {
  let worst = 0;
  for (const p of a) {
    let best = Infinity;
    for (let i = 1; i < b.length; i++) {
      const s = b[i - 1], e = b[i];
      const dx = e.x - s.x, dy = e.y - s.y;
      const t = Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p.x - (s.x + t * dx), p.y - (s.y + t * dy)));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

const shapePts = (s: Shape, tol = 1e-4) => flatten(s, tol);
const segmentsPts = (segments: Shape extends never ? never : Parameters<typeof toShape>[0]) => flatten(toShape(segments), 1e-4);
function toShape(segments: Extract<Shape, { type: "path" }>["segments"], closed = false): Shape {
  return {
    type: "path",
    name: "t",
    closed,
    segments,
    meta: { id: "t", layer: "", fill: "none", stroke: "none", strokeWidth: 0, linecap: "butt", linejoin: "miter", miterLimit: 4 },
  };
}

describe("curve fitting", () => {
  it("fits a sampled quarter circle within tolerance using one or two cubics", () => {
    const pts = Array.from({ length: 60 }, (_, i) => {
      const a = (i / 59) * (Math.PI / 2);
      return { x: 10 * Math.cos(a), y: 10 * Math.sin(a) };
    });
    const fit = fitCubics(pts, { x: 0, y: 1 }, { x: 1, y: 0 }, 0.005);
    expect(fit.segments.length).toBeLessThanOrEqual(2);
    expect(deviation(pts, segmentsPts(fit.segments))).toBeLessThan(0.006);
  });

  it("keeps straight edges straight and corners sharp when fitting a polyline", () => {
    // A 20 × 10 rectangle with rounded (r = 2) corners, flattened.
    const pts: Pt[] = [];
    const corner = (cx: number, cy: number, from: number) => {
      for (let i = 0; i <= 16; i++) {
        const a = from + (i / 16) * (Math.PI / 2);
        pts.push({ x: cx + 2 * Math.cos(a), y: cy + 2 * Math.sin(a) });
      }
    };
    corner(18, 8, 0);
    corner(2, 8, Math.PI / 2);
    corner(2, 2, Math.PI);
    corner(18, 2, (3 * Math.PI) / 2);
    const fit = fitPolyline(pts, true, 0.002, 30);
    expect(fit.segments.filter((s) => s.kind === "line")).toHaveLength(4);
    const shape = toShape(fit.segments, true);
    // Compare with the input polyline (itself slightly inside the true rounded rectangle).
    expect(deviation(pts, flatten(shape, 1e-4))).toBeLessThan(0.0025);
    expect(Math.abs(signedArea(flatten(shape, 1e-4)))).toBeCloseTo(Math.abs(signedArea(pts)), 1);
  });
});

describe("curve cleanup", () => {
  const base = run(ROCKET).prepared;
  const cleaned = run(ROCKET, { cleanup: true, cleanupStrength: 40 }).prepared;

  it("reduces the node count on the rocket badge", () => {
    const r = cleaned.cleanup!;
    expect(r.nodesAfter).toBeLessThan(r.nodesBefore);
    expect(r.maxDeviation).toBeLessThanOrEqual(r.tolerance);
  });

  it("stays within tolerance of the original geometry", () => {
    const tol = cleaned.cleanup!.tolerance;
    const byId = new Map(base.shapes.map((s) => [s.meta.id, s]));
    for (const s of cleaned.shapes) {
      const original = byId.get(s.meta.id)!;
      // Sampling error of both flattenings adds a little on top of the fit tolerance.
      expect(deviation(shapePts(original), shapePts(s))).toBeLessThan(tol * 1.1 + 2e-4);
    }
  });

  it("keeps every curve closed, every face, and smooth seams", () => {
    expect(cleaned.closedCount).toBe(29);
    expect(run(ROCKET, { cleanup: true, output: "faces" }).prepared.regions).toHaveLength(20);
    for (const s of cleaned.shapes) expect(seamTurn(s)).toBeLessThan(0.5);
  });

  it("removes more nodes at higher strength", () => {
    const low = run(ROCKET, { cleanup: true, cleanupStrength: 10 }).prepared.cleanup!;
    const high = run(ROCKET, { cleanup: true, cleanupStrength: 90 }).prepared.cleanup!;
    expect(high.nodesAfter).toBeLessThanOrEqual(low.nodesAfter);
    expect(high.tolerance).toBeGreaterThan(low.tolerance);
  });

  it("never adds nodes, and leaves exact circles alone", () => {
    const { prepared } = run(svg('<circle cx="10" cy="10" r="5"/><path d="M30 10 C30 20 40 20 40 10"/>'), { cleanup: true });
    expect(prepared.cleanup!.nodesAfter).toBeLessThanOrEqual(prepared.cleanup!.nodesBefore);
    expect(prepared.shapes[0].type).toBe("ellipse");
  });

  it("preserves sharp corners", () => {
    const star = svg('<path d="M50 5 L61 40 L95 40 L67 60 L78 95 L50 73 L22 95 L33 60 L5 40 L39 40 Z"/>');
    const { prepared } = run(star, { cleanup: true, cleanupStrength: 100 });
    const segs = prepared.shapes[0].type === "path" ? prepared.shapes[0].segments : [];
    // 10 edges, plus one extra where the seam was moved off a corner.
    expect(segs.filter((s) => s.kind === "line").length).toBeGreaterThanOrEqual(10);
    expect(Math.abs(area(prepared.shapes[0]))).toBeCloseTo(Math.abs(area(run(star).prepared.shapes[0])), 6);
  });

  it("shows the original as a ghost only while cleanup is on", () => {
    expect(cleaned.ghost).toHaveLength(29);
    expect(base.ghost).toHaveLength(0);
  });

  it("reverts exactly: turning cleanup off gives the original STEP data", () => {
    const data = (s: string) => s.slice(s.indexOf("DATA;"));
    const original = data(run(ROCKET).step());
    run(ROCKET, { cleanup: true, cleanupStrength: 70 });
    expect(data(run(ROCKET, { cleanup: false, cleanupStrength: 70 }).step())).toBe(original);
  });

  it("writes valid STEP references after cleanup", () => {
    const entities = stepEntities(run(ROCKET, { cleanup: true, output: "both" }).step());
    for (const [id, body] of entities) {
      for (const ref of body.match(/#\d+/g) ?? []) expect(entities.has(ref), `${id} → ${ref}`).toBe(true);
    }
  });
});

describe("stroke to outline", () => {
  const line = (cap: string) =>
    svg(`<path d="M10 50 H60" fill="none" stroke="#000" stroke-width="2" stroke-linecap="${cap}"/>`);

  it.each([
    ["butt", 100],
    ["round", 100 + Math.PI],
    ["square", 104],
  ])("outlines a %s-capped line to the stroke's area", (cap, expected) => {
    const { prepared } = run(line(cap), { outlineStrokes: true });
    expect(prepared.outlined).toBe(1);
    expect(prepared.shapes).toHaveLength(1);
    expect(prepared.closedCount).toBe(1);
    expect(Math.abs(area(prepared.shapes[0]))).toBeCloseTo(expected, 2);
  });

  it("turns a stroked circle into a ring face", () => {
    const ring = svg('<circle cx="50" cy="50" r="10" fill="none" stroke="#000" stroke-width="2"/>');
    const { prepared } = run(ring, { outlineStrokes: true, output: "faces" });
    expect(prepared.shapes).toHaveLength(2);
    expect(prepared.regions).toHaveLength(1);
    const r = prepared.regions[0];
    const faceArea = area(r.outer) + r.holes.reduce((sum, h) => sum + area(h), 0);
    expect(faceArea).toBeCloseTo(Math.PI * (11 * 11 - 9 * 9), 2);
  });

  it("keeps the outline's colour and drops the stroke-only warning", () => {
    const doc = svg('<path d="M10 50 H60" fill="none" stroke="#f00" stroke-width="2"/>');
    expect(run(doc).prepared.warnings.join(" ")).toMatch(/stroke-only/);
    const { prepared } = run(doc, { outlineStrokes: true });
    expect(prepared.warnings.join(" ")).not.toMatch(/stroke-only/);
    expect(prepared.shapes[0].meta.fill).toBe("#ff0000");
  });

  it("leaves filled shapes alone", () => {
    const { prepared } = run(ROCKET, { outlineStrokes: true });
    expect(prepared.outlined).toBe(0);
    expect(prepared.shapes).toHaveLength(29);
  });
});
