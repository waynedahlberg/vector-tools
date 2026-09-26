import { describe, expect, it } from "vitest";
import { ROCKET, area, run, svg } from "./helpers";

// 100 × 100 mm documents, so SVG units are millimetres.
const OPEN_SQUARE = '<path d="M10 10 H40 V40 H10 V10.02"/>'; // misses closing by 0.02
const TWO_HALVES = '<path d="M10 10 H40 V40"/><path d="M10.03 10 V40 H40"/>'; // second one runs backwards
const FIGURE_EIGHT = '<path d="M10 10 L40 40 L40 10 L10 40 Z"/>';

describe("defaults", () => {
  it("leave the rocket badge untouched and report no problems", () => {
    const { prepared } = run(ROCKET);
    expect(prepared.repairs.joins).toHaveLength(0);
    expect(prepared.problems).toMatchObject({
      openEnds: [],
      selfIntersections: [],
      selfIntersectingCurves: 0,
      nearGaps: 0,
      duplicateCurves: 0,
    });
  });
});

describe("close gaps", () => {
  it("snaps a nearly closed path shut", () => {
    const off = run(svg(OPEN_SQUARE)).prepared;
    expect(off.openCount).toBe(1);
    expect(off.problems.nearGaps).toBe(1);

    const on = run(svg(OPEN_SQUARE), { closeGaps: true, gapTolerance: 0.05 }).prepared;
    expect(on.openCount).toBe(0);
    expect(on.repairs.joins).toHaveLength(1);
    // Both ends meet at their midpoint, which moves one corner by 0.01.
    expect(Math.abs(area(on.shapes[0]))).toBeCloseTo(899.85, 6);
  });

  it("joins separate paths end to end, reversing one when needed, then closes the loop", () => {
    const { prepared } = run(svg(TWO_HALVES), { closeGaps: true, gapTolerance: 0.05 });
    expect(prepared.shapes).toHaveLength(1);
    expect(prepared.closedCount).toBe(1);
    expect(prepared.repairs.joins).toHaveLength(2);
  });

  it("leaves gaps wider than the tolerance alone", () => {
    // The halves still join where they touch exactly, but the 0.03 gap stays open.
    const { prepared } = run(svg(TWO_HALVES), { closeGaps: true, gapTolerance: 0.01 });
    expect(prepared.shapes).toHaveLength(1);
    expect(prepared.openCount).toBe(1);
    expect(prepared.repairs.joins).toHaveLength(1);
  });

  it("can build faces once gaps are closed", () => {
    expect(run(svg(OPEN_SQUARE), { output: "faces" }).prepared.regions).toHaveLength(0);
    expect(run(svg(OPEN_SQUARE), { output: "faces", closeGaps: true }).prepared.regions).toHaveLength(1);
  });
});

describe("duplicates and specks", () => {
  // The same square drawn as a rect and as a reversed path starting at another corner.
  const DUPES = '<rect x="10" y="10" width="20" height="20"/><path d="M30 30 V10 H10 V30 Z"/><rect x="50" y="50" width="0.2" height="0.2"/>';

  it("hints at duplicates while removal is off", () => {
    expect(run(svg(DUPES)).prepared.problems.duplicateCurves).toBe(1);
  });

  it("removes a reversed, re-seamed copy", () => {
    const { prepared } = run(svg(DUPES), { removeDuplicates: true });
    expect(prepared.repairs.duplicates).toBe(1);
    expect(prepared.shapes).toHaveLength(2);
  });

  it("removes shapes smaller than the minimum feature size", () => {
    const { prepared } = run(svg(DUPES), { minFeatureSize: 0.5 });
    expect(prepared.repairs.specks).toBe(1);
    expect(prepared.shapes).toHaveLength(2);
  });
});

describe("problem analysis", () => {
  it("finds self-intersections", () => {
    const { prepared } = run(svg(FIGURE_EIGHT), { origin: "svg" });
    expect(prepared.problems.selfIntersectingCurves).toBe(1);
    const [hit] = prepared.problems.selfIntersections;
    expect(hit.x).toBeCloseTo(25, 6);
    expect(hit.y).toBeCloseTo(-25, 6); // Y is flipped for CAD
  });

  it("marks open ends", () => {
    const { prepared } = run(svg('<path d="M0 0 L10 10"/>'));
    expect(prepared.problems.openEnds).toHaveLength(2);
  });

  it("reports a seam and direction for each closed curve", () => {
    const { prepared } = run(ROCKET);
    expect(prepared.seams).toHaveLength(29);
    for (const s of prepared.seams) expect(Math.hypot(s.dir.x, s.dir.y)).toBeCloseTo(1, 9);
  });
});
