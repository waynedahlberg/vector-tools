import { describe, expect, it } from "vitest";
import { polylineNodes, splineNodes } from "@/lib/nodes";
import { ROCKET, run, svg } from "./helpers";

describe("node overlay", () => {
  it("has one anchor per segment on closed splines", () => {
    const { prepared } = run(ROCKET);
    const segments = prepared.shapes.reduce((n, s) => n + (s.type === "path" ? s.segments.length : 0), 0);
    expect(splineNodes(prepared.shapes).anchors).toHaveLength(segments);
  });

  it("adds the end anchor on open paths and skips zero-length handles", () => {
    const { prepared } = run(svg('<path d="M0 0 C0 0 10 10 20 0 L30 0"/>'));
    const nodes = splineNodes(prepared.shapes);
    expect(nodes.anchors).toHaveLength(3);
    expect(nodes.handles).toHaveLength(1); // the first handle coincides with its anchor
  });

  it("gives exact circles no nodes", () => {
    const { prepared } = run(svg('<circle cx="10" cy="10" r="5"/>'));
    expect(splineNodes(prepared.shapes).anchors).toHaveLength(0);
  });

  it("shows fewer nodes after curve cleanup", () => {
    const before = splineNodes(run(ROCKET).prepared.shapes).anchors.length;
    const after = splineNodes(run(ROCKET, { cleanup: true, cleanupStrength: 80 }).prepared.shapes).anchors.length;
    expect(after).toBeLessThan(before);
  });

  it("lists polyline vertices without repeating the closing point", () => {
    const { prepared } = run(svg('<rect width="10" height="10"/>'), { curveMode: "polyline" });
    const nodes = polylineNodes(prepared.polylines);
    expect(nodes.anchors).toHaveLength(prepared.polylines[0].pts.length - 1);
    expect(nodes.handles).toHaveLength(0);
  });
});
