import { describe, expect, it } from "vitest";
import { run, svg } from "./helpers";

describe("exact bounds", () => {
  it("measure circles analytically, so the origin lands exactly on the edge", () => {
    const { prepared } = run(svg('<circle cx="50" cy="50" r="7"/>'));
    expect(prepared.bounds).toEqual({ minX: 0, minY: 0, maxX: 14, maxY: 14 });
  });

  it("measure rotated ellipses analytically", () => {
    const { prepared } = run(svg('<ellipse cx="50" cy="50" rx="10" ry="4" transform="rotate(90 50 50)"/>'), {
      origin: "center",
    });
    const b = prepared.bounds!;
    expect(b.maxX - b.minX).toBeCloseTo(8, 9);
    expect(b.maxY - b.minY).toBeCloseTo(20, 9);
  });

  it("include Bézier bulges beyond the end points", () => {
    // Peak of this curve is at y = 30 + 0.75 * 20 = 45, above both end points.
    const { prepared } = run(svg('<path d="M10 30 C10 10 30 10 30 30"/>'));
    expect(prepared.bounds!.maxY - prepared.bounds!.minY).toBeCloseTo(15, 9);
  });
});
