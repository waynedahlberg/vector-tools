import { describe, expect, it } from "vitest";
import { ROCKET, run, stepEntities, svg } from "./helpers";

// A 40 × 10 bar with a notch marker near its left end, so direction is observable.
const BAR = svg('<rect x="0" y="0" width="40" height="10"/><circle cx="5" cy="5" r="2" id="marker"/>');
const size = (b: { minX: number; maxX: number; minY: number; maxY: number }) => [b.maxX - b.minX, b.maxY - b.minY];

describe("rotation and mirroring", () => {
  it("swaps width and height for quarter turns", () => {
    const [w, h] = size(run(BAR, { rotation: 90 }).prepared.bounds!);
    expect(w).toBeCloseTo(10, 9);
    expect(h).toBeCloseTo(40, 9);
  });

  it("rotates counter-clockwise as seen in CAD", () => {
    // Marker starts at the left end; after 90° CCW it's at the bottom.
    const marker = run(BAR, { rotation: 90, origin: "bottom-left" }).prepared.shapes.find((s) => s.name === "marker")!;
    expect(marker.type).toBe("ellipse");
    if (marker.type === "ellipse") {
      expect(marker.center.x).toBeCloseTo(5, 9);
      expect(marker.center.y).toBeCloseTo(5, 9);
    }
  });

  it("mirrors horizontally and vertically", () => {
    const at = (patch: Parameters<typeof run>[1]) => {
      const s = run(BAR, patch).prepared.shapes.find((sh) => sh.name === "marker")!;
      return s.type === "ellipse" ? s.center : null;
    };
    expect(at({ mirrorX: true })!.x).toBeCloseTo(35, 9);
    expect(at({ mirrorY: true })!.y).toBeCloseTo(5, 9); // symmetric vertically
    expect(at({ rotation: 180 })!.x).toBeCloseTo(35, 9);
  });

  it("keeps outer boundaries CCW after mirroring", () => {
    const { prepared } = run(ROCKET, { mirrorX: true, output: "faces" });
    expect(prepared.regions).toHaveLength(20);
  });
});

describe("target size", () => {
  it("scales to an exact width", () => {
    const { prepared } = run(ROCKET, { sizeMode: "width", targetSize: 50 });
    const [w, h] = size(prepared.bounds!);
    expect(w).toBeCloseTo(50, 9);
    expect(h).toBeCloseTo(50, 9);
    expect(prepared.sizeNote).toMatch(/50 mm width/);
  });

  it("scales to an exact height after rotation, in inches", () => {
    const { prepared } = run(BAR, { sizeMode: "height", targetSize: 2, rotation: 90, unit: "in" });
    const [w, h] = size(prepared.bounds!);
    expect(h).toBeCloseTo(2, 9);
    expect(w).toBeCloseTo(0.5, 9);
  });

  it("ignores the scale factor in target-size mode", () => {
    const a = run(ROCKET, { sizeMode: "width", targetSize: 50, scale: 3 }).prepared.bounds;
    const b = run(ROCKET, { sizeMode: "width", targetSize: 50, scale: 1 }).prepared.bounds;
    expect(a).toEqual(b);
  });

  it("scales stroke widths along with the geometry", () => {
    const doc = svg('<path d="M0 0 H50" stroke="#000" stroke-width="2" fill="none"/>');
    const { prepared } = run(doc, { sizeMode: "width", targetSize: 100 });
    expect(prepared.shapes[0].meta.strokeWidth).toBeCloseTo(4, 9);
  });
});

describe("drawing plane", () => {
  const coords = (step: string) =>
    [...stepEntities(step).values()]
      .filter((e) => e.startsWith("CARTESIAN_POINT"))
      .map((e) => e.match(/\(([^()]*)\)\)$/)![1].split(",").map(Number));

  it("keeps XY output identical to the default", () => {
    const data = (s: string) => s.slice(s.indexOf("DATA;"));
    expect(data(run(ROCKET, { plane: "xy" }).step())).toBe(data(run(ROCKET).step()));
  });

  it("puts XZ drawings at Y = 0 with height along Z", () => {
    const pts = coords(run(ROCKET, { plane: "xz" }).step());
    expect(pts.every((p) => p[1] === 0)).toBe(true);
    expect(Math.max(...pts.map((p) => p[2]))).toBeCloseTo(33.3375, 3);
  });

  it("puts YZ drawings at X = 0", () => {
    const pts = coords(run(BAR, { plane: "yz" }).step());
    expect(pts.every((p) => p[0] === 0)).toBe(true);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(40, 9);
  });

  it("orients circles and face planes about the plane normal", () => {
    const step = run(BAR, { plane: "xz", output: "faces" }).step();
    expect(step).toContain("DIRECTION('',(0.,-1.,0.))");
    expect(step).toMatch(/CIRCLE\('marker'/);
    const entities = stepEntities(step);
    for (const [id, body] of entities) {
      for (const ref of body.match(/#\d+/g) ?? []) expect(entities.has(ref), `${id} → ${ref}`).toBe(true);
    }
  });
});
