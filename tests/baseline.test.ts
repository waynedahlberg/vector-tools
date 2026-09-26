import { describe, expect, it } from "vitest";
import { ROCKET, area, run, seamTurn, stepEntities, svg } from "./helpers";

describe("rocket badge fixture", () => {
  const { prepared } = run(ROCKET, { output: "both" });

  it("parses every subpath as a closed curve", () => {
    expect(prepared.shapes).toHaveLength(29);
    expect(prepared.closedCount).toBe(29);
    expect(prepared.openCount).toBe(0);
  });

  it("pairs outlines with their holes by even-odd nesting", () => {
    expect(prepared.regions).toHaveLength(20);
    const holes = prepared.regions.reduce((n, r) => n + r.holes.length, 0);
    expect(holes).toBe(9); // counters, rocket window + fin cut-outs, inner ring
  });

  it("orients outer boundaries CCW and holes CW", () => {
    for (const r of prepared.regions) {
      expect(area(r.outer)).toBeGreaterThan(0);
      for (const h of r.holes) expect(area(h)).toBeLessThan(0);
    }
  });

  it("never starts a closed curve on a sharp corner (Plasticity drops those)", () => {
    for (const s of prepared.shapes) expect(seamTurn(s)).toBeLessThan(0.5);
  });

  it("sizes the 126px document at 96 DPI and puts the origin bottom-left", () => {
    const b = prepared.bounds!;
    expect(b.minX).toBeCloseTo(0, 6);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxX).toBeCloseTo(33.3375, 3);
    expect(b.maxY).toBeCloseTo(33.3375, 3);
  });

  it("keeps total face area equal to the signed sum of its boundaries", () => {
    const total = prepared.shapes.reduce((sum, s) => sum + area(s), 0);
    const faces = prepared.regions.reduce(
      (sum, r) => sum + area(r.outer) + r.holes.reduce((h, s) => h + area(s), 0),
      0
    );
    expect(faces).toBeCloseTo(total, 6);
    expect(total).toBeGreaterThan(200);
    expect(total).toBeLessThan(240);
  });
});

describe("STEP output", () => {
  it("only references entities that exist", () => {
    for (const output of ["curves", "faces", "both"] as const) {
      for (const curveMode of ["spline", "polyline"] as const) {
        const entities = stepEntities(run(ROCKET, { output, curveMode }).step());
        for (const [id, body] of entities) {
          for (const ref of body.match(/#\d+/g) ?? []) {
            expect(entities.has(ref), `${id} references missing ${ref}`).toBe(true);
          }
        }
      }
    }
  });

  it("writes a well-formed AP214 file", () => {
    const step = run(ROCKET).step();
    expect(step.startsWith("ISO-10303-21;")).toBe(true);
    expect(step.trimEnd().endsWith("END-ISO-10303-21;")).toBe(true);
    expect(step).toContain("AUTOMOTIVE_DESIGN");
    expect(step).toContain("GEOMETRIC_CURVE_SET");
  });

  it("never marks B-splines as closed (OpenCASCADE would make them periodic)", () => {
    const step = run(ROCKET).step();
    for (const m of step.matchAll(/B_SPLINE_CURVE_WITH_KNOTS\('[^']*',3,\([^)]*\),\.UNSPECIFIED\.,(\.[TF]\.)/g)) {
      expect(m[1]).toBe(".F.");
    }
  });

  it("declares inches as a conversion-based unit", () => {
    const step = run(ROCKET, { unit: "in" }).step();
    expect(step).toContain("CONVERSION_BASED_UNIT('INCH'");
    expect(step).toContain("LENGTH_MEASURE(25.4)");
  });

  it("is deterministic apart from the header timestamp", () => {
    const data = (s: string) => s.slice(s.indexOf("DATA;"));
    expect(data(run(ROCKET).step())).toBe(data(run(ROCKET).step()));
  });
});

describe("SVG parsing", () => {
  it("handles compact arc flags, exponents, and implicit commands", () => {
    const { prepared } = run(
      svg('<path d="M0 5a5 5 0 1010 0 5 5 0 10-10 0z"/><path d="M20,0 1e1,0 10 10z"/>'),
      { origin: "svg" }
    );
    const areas = prepared.shapes.map((s) => Math.abs(area(s)));
    expect(areas[0]).toBeCloseTo(Math.PI * 25, 1);
    expect(areas[1]).toBeCloseTo(50, 6);
  });

  it("applies nested transforms and <use>", () => {
    const { prepared } = run(
      svg('<defs><rect id="r" width="10" height="10"/></defs><g transform="translate(50 0) scale(2)"><use href="#r" x="5"/></g>'),
      { origin: "svg" }
    );
    const b = prepared.bounds!;
    expect(b.minX).toBeCloseTo(60, 6);
    expect(b.maxX - b.minX).toBeCloseTo(20, 6);
  });

  it("warns about text and skips it", () => {
    const { prepared } = run(svg('<rect width="5" height="5"/><text>hi</text>'));
    expect(prepared.shapes).toHaveLength(1);
    expect(prepared.warnings.join(" ")).toMatch(/text/i);
  });
});
