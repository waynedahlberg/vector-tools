// Blender-style turntable camera maths, independent of three.js so it can be unit tested.
//
// The view is described by yaw (around world Z), pitch (elevation, clamped to ±90°), a distance
// and a target. The camera basis is built explicitly, so looking straight down or up is exact
// (no gimbal lock), with screen-up following yaw the way Blender's top and bottom views do.

export type Vec3 = [number, number, number];
export type ViewAngles = { yaw: number; pitch: number };
export type ViewState = ViewAngles & { dist: number; target: Vec3 };
export type AxisKey = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

const HALF_PI = Math.PI / 2;

/** Axis views, named by where the camera sits: "+x" looks from +X towards the target. */
export const AXIS_VIEWS: Record<AxisKey, ViewAngles> = {
  "+x": { yaw: 0, pitch: 0 }, // Right
  "-x": { yaw: Math.PI, pitch: 0 }, // Left
  "+y": { yaw: HALF_PI, pitch: 0 }, // Back
  "-y": { yaw: -HALF_PI, pitch: 0 }, // Front
  "+z": { yaw: -HALF_PI, pitch: HALF_PI }, // Top: X right, Y up
  "-z": { yaw: -HALF_PI, pitch: -HALF_PI }, // Bottom
};

export const AXIS_VECTORS: Record<AxisKey, Vec3> = {
  "+x": [1, 0, 0],
  "-x": [-1, 0, 0],
  "+y": [0, 1, 0],
  "-y": [0, -1, 0],
  "+z": [0, 0, 1],
  "-z": [0, 0, -1],
};

export const OPPOSITE: Record<AxisKey, AxisKey> = {
  "+x": "-x",
  "-x": "+x",
  "+y": "-y",
  "-y": "+y",
  "+z": "-z",
  "-z": "+z",
};

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const clampPitch = (p: number) => Math.max(-HALF_PI, Math.min(HALF_PI, p));

/**
 * Camera basis for a view: `dir` points from the target to the camera, `right` and `up` are the
 * screen axes. `right` depends on yaw only, so it stays defined at the poles.
 */
export function basis({ yaw, pitch }: ViewAngles): { dir: Vec3; right: Vec3; up: Vec3 } {
  const cp = Math.cos(pitch);
  const dir: Vec3 = [cp * Math.cos(yaw), cp * Math.sin(yaw), Math.sin(pitch)];
  const right: Vec3 = [-Math.sin(yaw), Math.cos(yaw), 0];
  return { dir, right, up: cross(dir, right) };
}

/** The view looking along a direction (target → camera), for arbitrary directions like iso. */
export function anglesFor(dir: Vec3): ViewAngles {
  const len = Math.hypot(...dir) || 1;
  const [x, y, z] = [dir[0] / len, dir[1] / len, dir[2] / len];
  const pitch = Math.asin(Math.max(-1, Math.min(1, z)));
  // At the poles yaw is free; keep Blender's top/bottom orientation.
  const yaw = Math.abs(Math.cos(pitch)) < 1e-9 ? -HALF_PI : Math.atan2(y, x);
  return { yaw, pitch };
}

/**
 * Which axis view is active, if any. Like Blender, the whole orientation must match: looking
 * straight down but spun around Z is a "User" view, not "Top".
 */
export function alignedAxis(v: ViewAngles, tolerance = 1e-3): AxisKey | null {
  const { dir, right } = basis(v);
  for (const key of Object.keys(AXIS_VECTORS) as AxisKey[]) {
    if (dot(dir, AXIS_VECTORS[key]) > 1 - tolerance && dot(right, basis(AXIS_VIEWS[key]).right) > 1 - tolerance) {
      return key;
    }
  }
  return null;
}

/** Clicking an axis ball: go to that view, or to the opposite one if already there (Blender). */
export function axisClickTarget(axis: AxisKey, current: ViewAngles): AxisKey {
  return alignedAxis(current) === axis ? OPPOSITE[axis] : axis;
}

/** Where each axis end appears on the gizmo: x right, y up (−1..1), and depth towards the viewer. */
export function projectAxes(v: ViewAngles): Record<AxisKey, { x: number; y: number; depth: number }> {
  const { dir, right, up } = basis(v);
  const out = {} as Record<AxisKey, { x: number; y: number; depth: number }>;
  for (const key of Object.keys(AXIS_VECTORS) as AxisKey[]) {
    const a = AXIS_VECTORS[key];
    out[key] = { x: dot(a, right), y: dot(a, up), depth: dot(a, dir) };
  }
  return out;
}

/** Turntable orbit from a pointer drag, in pixels. Dragging right spins the scene right. */
export function orbit(v: ViewAngles, dx: number, dy: number, radiansPerPixel = 0.008): ViewAngles {
  return { yaw: v.yaw - dx * radiansPerPixel, pitch: clampPitch(v.pitch + dy * radiansPerPixel) };
}

/** Signed shortest angular difference from a to b. */
export function angleDelta(a: number, b: number): number {
  const d = (b - a) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d;
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Interpolate views: yaw the short way round, distance geometrically, target linearly. */
export function lerpView(a: ViewState, b: ViewState, t: number): ViewState {
  return {
    yaw: a.yaw + angleDelta(a.yaw, b.yaw) * t,
    pitch: a.pitch + (b.pitch - a.pitch) * t,
    dist: a.dist * (b.dist / a.dist) ** t,
    target: [
      a.target[0] + (b.target[0] - a.target[0]) * t,
      a.target[1] + (b.target[1] - a.target[1]) * t,
      a.target[2] + (b.target[2] - a.target[2]) * t,
    ],
  };
}

/** Camera position for a view. */
export function cameraPosition(v: ViewState): Vec3 {
  const { dir } = basis(v);
  return [v.target[0] + dir[0] * v.dist, v.target[1] + dir[1] * v.dist, v.target[2] + dir[2] * v.dist];
}

/**
 * Distance at which a sphere of `radius` fits the visible part of the view. `visW`/`visH` are
 * the unobstructed area and `h` the full canvas height (the vertical fov spans all of `h`).
 */
export function fitDistance(radius: number, fovDeg: number, visW: number, visH: number, h: number, margin = 1.15) {
  const tanV = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const half = Math.min(Math.atan((tanV * visH) / h), Math.atan((tanV * visW) / h));
  return (radius / Math.tan(half)) * margin;
}

/** Half-height of the orthographic frustum that matches the perspective view at `dist`. */
export const orthoHalfHeight = (dist: number, fovDeg: number) => dist * Math.tan(((fovDeg / 2) * Math.PI) / 180);

/** World units per screen pixel at the target, for panning. */
export const worldPerPixel = (dist: number, fovDeg: number, canvasHeight: number) =>
  (2 * orthoHalfHeight(dist, fovDeg)) / Math.max(1, canvasHeight);

/** Screen-space pan: move the target so the scene follows the pointer. */
export function pan(v: ViewState, dx: number, dy: number, unitsPerPixel: number): ViewState {
  const { right, up } = basis(v);
  const k = unitsPerPixel;
  return {
    ...v,
    target: [
      v.target[0] - right[0] * dx * k + up[0] * dy * k,
      v.target[1] - right[1] * dx * k + up[1] * dy * k,
      v.target[2] - right[2] * dx * k + up[2] * dy * k,
    ],
  };
}

/** Zoom by a factor (>1 zooms in), keeping distance within sane bounds of the drawing size. */
export function zoom(v: ViewState, factor: number, radius: number): ViewState {
  const dist = Math.min(radius * 400, Math.max(radius * 0.02, v.dist / factor));
  return { ...v, dist };
}
