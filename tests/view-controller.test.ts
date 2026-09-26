import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { AXIS_VIEWS, alignedAxis } from "@/lib/camera";
import { ISO_ANGLES, ViewController } from "@/components/app/view-controller";

/** A controller framing a drawing centred at (50, 20, 0) with radius 10, like a loaded SVG. */
function setup() {
  const c = new ViewController();
  c.setSize(1200, 800);
  c.setFrame([50, 20, 0], 10);
  c.fit({ angles: ISO_ANGLES });
  return c;
}

/** Run an animation to completion. */
function finish(c: ViewController) {
  let now = performance.now();
  while (c.tick((now += 16))) {
    /* step */
  }
}

const lookTarget = (cam: THREE.Camera, dist: number) => {
  cam.updateMatrixWorld();
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  return cam.position.clone().addScaledVector(dir, dist);
};

describe("view controller", () => {
  it("frames the drawing's centre, not the world origin", () => {
    const c = setup();
    expect(c.view.target).toEqual([50, 20, 0]);
    const t = lookTarget(c.perspective, c.view.dist);
    expect(t.x).toBeCloseTo(50, 6);
    expect(t.y).toBeCloseTo(20, 6);
    expect(t.z).toBeCloseTo(0, 6);
  });

  it("animates to an axis view, then switches to orthographic (auto perspective)", () => {
    const c = setup();
    c.clickAxis("+z");
    expect(c.ortho).toBe(false); // still perspective while turning
    c.tick(performance.now() + 100);
    expect(alignedAxis(c.view)).toBeNull(); // mid-animation
    finish(c);
    expect(alignedAxis(c.view)).toBe("+z");
    expect(c.ortho).toBe(true);
    expect(c.getSnapshot().name).toBe("Top Orthographic");
  });

  it("re-centres on the drawing even after panning away", () => {
    const c = setup();
    c.panBy(300, -120);
    expect(c.view.target).not.toEqual([50, 20, 0]);
    c.clickAxis("-y");
    finish(c);
    c.view.target.forEach((v, i) => expect(v).toBeCloseTo([50, 20, 0][i], 9));
    expect(c.getSnapshot().name).toBe("Front Orthographic");
  });

  it("flips to the opposite view when the active axis is clicked again", () => {
    const c = setup();
    c.clickAxis("+x");
    finish(c);
    c.clickAxis("+x");
    finish(c);
    expect(alignedAxis(c.view)).toBe("-x");
  });

  it("flips on a quick second click, before the first animation finishes", () => {
    const c = setup();
    c.clickAxis("+x");
    c.tick(performance.now() + 50);
    c.clickAxis("+x");
    finish(c);
    expect(alignedAxis(c.view)).toBe("-x");
  });

  it("returns to perspective when orbiting away from an automatic orthographic view", () => {
    const c = setup();
    c.clickAxis("+z");
    finish(c);
    c.orbitBy(40, 0);
    expect(c.ortho).toBe(false);
    expect(c.getSnapshot().name).toBe("User Perspective");
  });

  it("keeps orthographic through orbiting when chosen explicitly", () => {
    const c = setup();
    c.toggleOrtho();
    c.orbitBy(40, 20);
    expect(c.ortho).toBe(true);
    expect(c.camera).toBe(c.orthographic);
    c.toggleOrtho();
    expect(c.camera).toBe(c.perspective);
  });

  it("looks straight down in the top view with X right and Y up", () => {
    const c = setup();
    c.clickAxis("+z");
    finish(c);
    const cam = c.orthographic;
    cam.updateMatrixWorld();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    expect(right.x).toBeCloseTo(1, 9);
    expect(up.y).toBeCloseTo(1, 9);
    expect(forward.z).toBeCloseTo(-1, 9);
  });

  it("zooms and matches the orthographic frustum to the perspective view", () => {
    const c = setup();
    const before = c.view.dist;
    c.zoomBy(2);
    expect(c.view.dist).toBeCloseTo(before / 2, 9);
    const halfH = c.view.dist * Math.tan(((35 / 2) * Math.PI) / 180);
    expect(c.orthographic.top).toBeCloseTo(halfH, 9);
  });

  it("returns to perspective for the iso view after an automatic orthographic view", () => {
    const c = setup();
    c.clickAxis("+y");
    finish(c);
    c.lookFrom(ISO_ANGLES);
    finish(c);
    expect(c.ortho).toBe(false);
    expect(c.view.pitch).toBeCloseTo(ISO_ANGLES.pitch, 9);
  });

  it("offsets the projection into the gap between panels", () => {
    const c = setup();
    c.setInsets({ top: 76, right: 372, bottom: 76, left: 352 });
    expect(c.perspective.view?.offsetX).toBe(10);
    expect(c.orthographic.view?.offsetX).toBe(10);
  });

  it("axis views are exact", () => {
    for (const key of Object.keys(AXIS_VIEWS) as (keyof typeof AXIS_VIEWS)[]) {
      const c = setup();
      c.clickAxis(key);
      finish(c);
      expect(alignedAxis(c.view, 1e-12)).toBe(key);
    }
  });
});
