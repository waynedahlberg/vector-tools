import { describe, expect, it } from "vitest";
import { normalizePaint } from "@/lib/paint";
import { memoStage } from "@/lib/pipeline";
import { ROCKET, run, svg } from "./helpers";

describe("stable shape ids", () => {
  it("are unique across the rocket badge", () => {
    const ids = run(ROCKET).prepared.shapes.map((s) => s.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("do not change with unrelated settings", () => {
    const ids = (patch: Parameters<typeof run>[1]) =>
      run(ROCKET, patch).prepared.shapes.map((s) => s.meta.id).sort();
    const base = ids({});
    expect(ids({ unit: "in", origin: "center", output: "both" })).toEqual(base);
    expect(ids({ curveMode: "polyline", scale: 3 })).toEqual(base);
  });

  it("use element ids when present and structural paths otherwise", () => {
    const { prepared } = run(svg('<g id="logo"><path d="M0 0h1v1z M5 5h1v1z"/><rect id="box" width="2" height="2"/></g>'));
    const ids = prepared.shapes.map((s) => s.meta.id);
    expect(ids).toContain("svg/#logo/path[0]:0");
    expect(ids).toContain("svg/#logo/path[0]:1");
    expect(ids).toContain("svg/#logo/#box:0");
  });

  it("stay distinct for repeated <use> instances", () => {
    const { prepared } = run(
      svg('<defs><rect id="r" width="1" height="1"/></defs><use id="a" href="#r"/><use id="b" href="#r" x="5"/>')
    );
    const ids = prepared.shapes.map((s) => s.meta.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("layers and paint", () => {
  const doc = svg(
    '<g inkscape:label="Cut" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><rect width="1" height="1" fill="red"/></g>' +
      '<g id="engrave" style="fill:none;stroke:#00F;stroke-width:0.5"><circle r="2" cx="5" cy="5"/></g>' +
      '<rect x="8" width="1" height="1" fill="rgb(0, 128, 0)"/>'
  );

  it("treats top-level groups as layers, named from inkscape:label or id", () => {
    const { prepared } = run(doc, { origin: "svg" });
    expect(prepared.layers.map((l) => l.name)).toEqual(["Cut", "engrave", "Ungrouped"]);
  });

  it("normalises fill and stroke colours", () => {
    const { prepared } = run(doc, { origin: "svg" });
    const [cut, engrave, loose] = prepared.shapes;
    expect(cut.meta.fill).toBe("#ff0000");
    expect(engrave.meta.fill).toBe("none");
    expect(engrave.meta.stroke).toBe("#0000ff");
    expect(loose.meta.fill).toBe("#008000");
  });

  it("scales stroke width with the drawing (0.5 user units → 0.5 mm here)", () => {
    const { prepared } = run(doc, { origin: "svg" });
    expect(prepared.shapes[1].meta.strokeWidth).toBeCloseTo(0.5, 9);
    const doubled = run(doc, { origin: "svg", scale: 2 }).prepared;
    expect(doubled.shapes[1].meta.strokeWidth).toBeCloseTo(1, 9);
  });

  it.each([
    ["#abc", "#aabbcc"],
    ["#AABBCC80", "#aabbcc"],
    ["White", "#ffffff"],
    ["rgb(100%, 0%, 0%)", "#ff0000"],
    ["url(#g1)", "gradient"],
    ["none", "none"],
    ["inherit", null],
  ])("normalizePaint(%s) → %s", (input, expected) => {
    expect(normalizePaint(input)).toBe(expected);
  });
});

describe("memoised stages", () => {
  it("reuse the last result for identical input and settings", () => {
    let calls = 0;
    const stage = memoStage((input: number[], p: { k: number }) => {
      calls++;
      return input.map((v) => v * p.k);
    });
    const input = [1, 2];
    const a = stage(input, { k: 2 });
    expect(stage(input, { k: 2 })).toBe(a);
    expect(calls).toBe(1);
    stage(input, { k: 3 });
    stage([1, 2], { k: 3 });
    expect(calls).toBe(3);
  });

  it("keep prepare() results independent across calls", () => {
    const a = run(ROCKET).prepared;
    const b = run(ROCKET, { origin: "center" }).prepared;
    const c = run(ROCKET).prepared;
    expect(c.bounds).toEqual(a.bounds);
    expect(b.bounds!.minX).toBeLessThan(0);
  });
});
