import { describe, expect, it } from "vitest";
import { ROCKET, run, svg } from "./helpers";

const DOC = svg(
  '<g id="cut"><rect width="10" height="10" fill="#f00"/><rect x="20" width="10" height="10" fill="#f00"/></g>' +
    '<g id="engrave"><circle cx="50" cy="50" r="5" fill="none" stroke="#00f"/></g>' +
    '<rect x="80" width="5" height="5" fill="#000"/>'
);

describe("layer and colour catalogue", () => {
  it("counts shapes per layer and per display colour", () => {
    const { prepared } = run(DOC);
    expect(prepared.layers.map((l) => [l.name, l.count])).toEqual([
      ["cut", 2],
      ["engrave", 1],
      ["Ungrouped", 1],
    ]);
    expect(prepared.colors).toEqual([
      { color: "#ff0000", count: 2 },
      { color: "#0000ff", count: 1 }, // stroke colour, since the circle is unfilled
      { color: "#000000", count: 1 },
    ]);
  });

  it("is unaffected by what's hidden", () => {
    const { prepared } = run(DOC, { hiddenLayers: ["svg/#cut"] });
    expect(prepared.layers[0].count).toBe(2);
  });

  it("reports the rocket badge as a single white, ungrouped layer", () => {
    const { prepared } = run(ROCKET);
    expect(prepared.layers).toEqual([{ id: "~ungrouped", name: "Ungrouped", count: 29 }]);
    expect(prepared.colors).toEqual([{ color: "#ffffff", count: 29 }]);
  });
});

describe("hiding layers and colours", () => {
  it("leaves out hidden layers", () => {
    const { prepared } = run(DOC, { hiddenLayers: ["svg/#cut"] });
    expect(prepared.shapes.map((s) => s.meta.layer)).toEqual(["svg/#engrave", "~ungrouped"]);
  });

  it("leaves out hidden colours", () => {
    const { prepared } = run(DOC, { hiddenColors: ["#ff0000", "#000000"] });
    expect(prepared.shapes).toHaveLength(1);
    expect(prepared.shapes[0].meta.stroke).toBe("#0000ff");
  });

  it("re-frames the origin around what's left", () => {
    const { prepared } = run(DOC, { hiddenLayers: ["svg/#cut", "~ungrouped"] });
    expect(prepared.bounds!.minX).toBeCloseTo(0, 9);
    expect(prepared.bounds!.maxX).toBeCloseTo(10, 9);
  });

  it("handles hiding everything", () => {
    const { prepared, step } = run(DOC, { hiddenColors: ["#ff0000", "#000000", "#0000ff"] });
    expect(prepared.shapes).toHaveLength(0);
    expect(prepared.bounds).toBeNull();
    expect(step()).toContain("END-ISO-10303-21;");
  });

  it("names STEP curves after SVG ids", () => {
    const step = run(svg('<path id="outline" d="M0 0h5v5z M10 0h5v5z"/>')).step();
    expect(step).toContain("'outline'");
    expect(step).toContain("'outline.2'");
  });
});
