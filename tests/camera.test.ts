import { describe, expect, it } from "vitest";
import {
  AXIS_VIEWS,
  alignedAxis,
  anglesFor,
  axisClickTarget,
  basis,
  cameraPosition,
  easeInOutCubic,
  fitDistance,
  lerpView,
  orbit,
  pan,
  projectAxes,
  zoom,
  type AxisKey,
  type Vec3,
  type ViewState,
} from "@/lib/camera";

const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("camera basis", () => {
  it("is orthonormal everywhere, including straight up and down", () => {
    for (const pitch of [-Math.PI / 2, -1, 0, 0.7, Math.PI / 2]) {
      for (const yaw of [-3, -Math.PI / 2, 0, 1, 2.5]) {
        const { dir, right, up } = basis({ yaw, pitch });
        for (const v of [dir, right, up]) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
        expect(dot(dir, right)).toBeCloseTo(0, 9);
        expect(dot(dir, up)).toBeCloseTo(0, 9);
        expect(dot(right, up)).toBeCloseTo(0, 9);
      }
    }
  });

  it("matches Blender's axis views", () => {
    // Top: looking down, X right, Y up on screen.
    let b = basis(AXIS_VIEWS["+z"]);
    close(b.dir, [0, 0, 1]);
    close(b.right, [1, 0, 0]);
    close(b.up, [0, 1, 0]);
    // Front: camera at −Y, X right, Z up.
    b = basis(AXIS_VIEWS["-y"]);
    close(b.dir, [0, -1, 0]);
    close(b.right, [1, 0, 0]);
    close(b.up, [0, 0, 1]);
    // Right: camera at +X, Y right, Z up.
    b = basis(AXIS_VIEWS["+x"]);
    close(b.dir, [1, 0, 0]);
    close(b.right, [0, 1, 0]);
    close(b.up, [0, 0, 1]);
  });

  it("round-trips directions through anglesFor", () => {
    const dir: Vec3 = [0.55, -1, 0.95];
    const b = basis(anglesFor(dir));
    const n = Math.hypot(...dir);
    close(b.dir, [dir[0] / n, dir[1] / n, dir[2] / n]);
    expect(anglesFor([0, 0, 5])).toEqual(AXIS_VIEWS["+z"]);
  });
});

describe("gizmo", () => {
  it("projects the axes as Blender draws them in the top view", () => {
    const p = projectAxes(AXIS_VIEWS["+z"]);
    expect(p["+x"].x).toBeCloseTo(1, 9);
    expect(p["+x"].y).toBeCloseTo(0, 9);
    expect(p["+y"].y).toBeCloseTo(1, 9);
    expect(p["+z"].depth).toBeCloseTo(1, 9); // facing the viewer, drawn in the centre
    expect(Math.hypot(p["+z"].x, p["+z"].y)).toBeCloseTo(0, 9);
  });

  it("detects which axis view is active", () => {
    for (const key of Object.keys(AXIS_VIEWS) as AxisKey[]) expect(alignedAxis(AXIS_VIEWS[key])).toBe(key);
    expect(alignedAxis({ yaw: 0.3, pitch: 0.4 })).toBeNull();
    // Straight down but spun around Z is a user view, as in Blender.
    expect(alignedAxis({ yaw: 0.3, pitch: Math.PI / 2 })).toBeNull();
  });

  it("goes to the clicked axis, or flips to the opposite when already there", () => {
    expect(axisClickTarget("+z", { yaw: 0.3, pitch: 0.4 })).toBe("+z");
    expect(axisClickTarget("+z", AXIS_VIEWS["+z"])).toBe("-z");
    expect(axisClickTarget("-y", AXIS_VIEWS["-y"])).toBe("+y");
    expect(axisClickTarget("+x", AXIS_VIEWS["-y"])).toBe("+x");
  });
});

describe("navigation", () => {
  const base: ViewState = { yaw: 0.2, pitch: 0.3, dist: 100, target: [10, 20, 0] };

  it("orbits as a turntable and clamps at the poles", () => {
    expect(orbit(base, 10, 0).yaw).toBeLessThan(base.yaw);
    expect(orbit(base, 0, 10_000).pitch).toBeCloseTo(Math.PI / 2, 9);
    expect(orbit(base, 0, -10_000).pitch).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("keeps the camera at its distance from the target", () => {
    const pos = cameraPosition(base);
    expect(Math.hypot(pos[0] - 10, pos[1] - 20, pos[2])).toBeCloseTo(100, 9);
  });

  it("pans in the screen plane, following the pointer", () => {
    const top: ViewState = { ...AXIS_VIEWS["+z"], dist: 100, target: [0, 0, 0] };
    // Dragging right by 10px at 0.5 units/px moves the view right, so the target moves left.
    close(pan(top, 10, 0, 0.5).target, [-5, 0, 0]);
    close(pan(top, 0, 10, 0.5).target, [0, 5, 0]);
  });

  it("zooms by a factor within bounds", () => {
    expect(zoom(base, 2, 10).dist).toBeCloseTo(50, 9);
    expect(zoom(base, 1e9, 10).dist).toBeCloseTo(0.2, 9);
    expect(zoom(base, 1e-9, 10).dist).toBeCloseTo(4000, 9);
  });

  it("animates yaw the short way round and ends exactly on the target view", () => {
    const a: ViewState = { yaw: 3, pitch: 0, dist: 10, target: [0, 0, 0] };
    const b: ViewState = { yaw: -3, pitch: 0.5, dist: 40, target: [4, 0, 0] };
    const mid = lerpView(a, b, 0.5);
    expect(Math.abs(mid.yaw)).toBeGreaterThan(3); // through ±π, not through 0
    expect(mid.dist).toBeCloseTo(20, 9); // geometric
    const end = lerpView(a, b, 1);
    expect(Math.cos(end.yaw)).toBeCloseTo(Math.cos(-3), 9);
    expect(end.pitch).toBe(0.5);
    close(end.target, [4, 0, 0]);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("fits a drawing into the visible gap between panels", () => {
    const full = fitDistance(10, 35, 1000, 800, 800);
    const narrow = fitDistance(10, 35, 300, 600, 800);
    expect(narrow).toBeGreaterThan(full);
  });
});
