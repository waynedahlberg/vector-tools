// Blender-style navigation for the 3D preview: turntable orbit, pan, zoom, animated axis views,
// and perspective/orthographic projection with Blender's "auto perspective" behaviour (axis views
// switch to orthographic; orbiting away switches back unless orthographic was chosen explicitly).

import * as THREE from "three";
import {
  AXIS_VIEWS,
  alignedAxis,
  anglesFor,
  axisClickTarget,
  basis,
  easeInOutCubic,
  fitDistance,
  lerpView,
  orbit,
  orthoHalfHeight,
  pan,
  worldPerPixel,
  zoom,
  type AxisKey,
  type Vec3,
  type ViewAngles,
  type ViewState,
} from "@/lib/camera";

export type Insets = { top: number; right: number; bottom: number; left: number };

export type ViewSnapshot = {
  view: ViewState;
  ortho: boolean;
  aligned: AxisKey | null;
  name: string;
};

const FOV = 35;
const ANIMATION_MS = 280;
export const ISO_ANGLES = anglesFor([0.55, -1, 0.95]);

const VIEW_NAMES: Record<AxisKey, string> = {
  "+z": "Top",
  "-z": "Bottom",
  "-y": "Front",
  "+y": "Back",
  "+x": "Right",
  "-x": "Left",
};

export class ViewController {
  readonly perspective = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000);
  readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  view: ViewState = { ...ISO_ANGLES, dist: 10, target: [0, 0, 0] };
  ortho = false;
  /** Orthographic entered automatically by an axis view (reverts when orbiting away). */
  private autoOrtho = false;
  private frame: { center: Vec3; radius: number } = { center: [0, 0, 0], radius: 1 };
  private size = { w: 1, h: 1 };
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private anim: { from: ViewState; to: ViewState; start: number; then?: () => void } | null = null;
  private listeners = new Set<() => void>();
  private snap: ViewSnapshot;
  private onChange: () => void = () => {};

  constructor() {
    this.snap = this.makeSnapshot();
    this.apply();
  }

  /** Called whenever the view changes, so the renderer can draw a frame. */
  setOnChange(fn: () => void) {
    this.onChange = fn;
  }

  get camera(): THREE.Camera {
    return this.ortho ? this.orthographic : this.perspective;
  }

  // --- External state ----------------------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snap;

  setSize(w: number, h: number) {
    this.size = { w, h };
    this.apply();
  }

  setInsets(insets: Insets) {
    this.insets = insets;
    this.apply();
  }

  /** The drawing's extents: views always centre on this, never the world origin. */
  setFrame(center: Vec3, radius: number) {
    this.frame = { center, radius: Math.max(radius, 1e-6) };
    this.apply();
  }

  // --- Commands ----------------------------------------------------------------------------

  /** Frame the drawing, optionally from a new direction. */
  fit(opts: { angles?: ViewAngles; animate?: boolean } = {}) {
    const i = this.insets;
    const dist = fitDistance(
      this.frame.radius,
      FOV,
      Math.max(this.size.w - i.left - i.right, 80),
      Math.max(this.size.h - i.top - i.bottom, 80),
      this.size.h
    );
    const to: ViewState = { ...(opts.angles ?? this.view), dist, target: [...this.frame.center] };
    if (opts.animate) this.animateTo(to);
    else this.jumpTo(to);
  }

  /** Gizmo click: go to an axis view (or its opposite if already there), centred on the drawing. */
  clickAxis(axis: AxisKey) {
    // Judge "already there" by where an in-flight animation is heading, so a quick second click
    // flips to the opposite side just as it would once the first finished.
    const key = axisClickTarget(axis, this.anim?.to ?? this.view);
    this.animateTo({ ...AXIS_VIEWS[key], dist: this.view.dist, target: [...this.frame.center] }, () => {
      if (!this.ortho) {
        this.ortho = true;
        this.autoOrtho = true;
        this.apply();
      }
    });
  }

  /** Iso or other free views return to perspective if orthographic was only automatic. */
  lookFrom(angles: ViewAngles) {
    this.leaveAutoOrtho();
    this.animateTo({ ...angles, dist: this.view.dist, target: [...this.frame.center] });
  }

  orbitBy(dx: number, dy: number) {
    this.anim = null;
    this.leaveAutoOrtho();
    this.view = { ...this.view, ...orbit(this.view, dx, dy) };
    this.apply();
  }

  panBy(dx: number, dy: number) {
    this.anim = null;
    this.view = pan(this.view, dx, dy, worldPerPixel(this.view.dist, FOV, this.size.h));
    this.apply();
  }

  zoomBy(factor: number) {
    this.anim = null;
    this.view = zoom(this.view, factor, this.frame.radius);
    this.apply();
  }

  toggleOrtho() {
    this.ortho = !this.ortho;
    this.autoOrtho = false; // an explicit choice sticks
    this.apply();
  }

  /** Advance any running animation. Returns true while animating. */
  tick(now: number): boolean {
    if (!this.anim) return false;
    const t = Math.min(1, (now - this.anim.start) / ANIMATION_MS);
    this.view = lerpView(this.anim.from, this.anim.to, easeInOutCubic(t));
    if (t >= 1) {
      this.view = this.anim.to;
      const then = this.anim.then;
      this.anim = null;
      then?.();
    }
    this.apply();
    return true;
  }

  // --- Internals ---------------------------------------------------------------------------

  private jumpTo(to: ViewState) {
    this.anim = null;
    this.view = to;
    this.apply();
  }

  private animateTo(to: ViewState, then?: () => void) {
    this.anim = { from: this.view, to, start: performance.now(), then };
    this.onChange();
  }

  private leaveAutoOrtho() {
    if (this.autoOrtho) {
      this.ortho = false;
      this.autoOrtho = false;
    }
  }

  private makeSnapshot(): ViewSnapshot {
    const aligned = alignedAxis(this.view);
    const name = `${aligned ? VIEW_NAMES[aligned] : "User"} ${this.ortho ? "Orthographic" : "Perspective"}`;
    return { view: this.view, ortho: this.ortho, aligned, name };
  }

  /** Position both cameras from the view state and notify listeners. */
  private apply() {
    const { dir, right, up } = basis(this.view);
    const rotation = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...right),
      new THREE.Vector3(...up),
      new THREE.Vector3(...dir)
    );
    const [tx, ty, tz] = this.view.target;
    const { w, h } = this.size;
    const i = this.insets;
    // Panels cover the canvas edges; shift the projection centre into the visible gap.
    const offX = (i.right - i.left) / 2, offY = (i.bottom - i.top) / 2;

    const p = this.perspective;
    const d = this.view.dist;
    p.position.set(tx + dir[0] * d, ty + dir[1] * d, tz + dir[2] * d);
    p.setRotationFromMatrix(rotation);
    p.aspect = w / h;
    p.near = d / 1000;
    p.far = d * 100 + this.frame.radius * 10;
    p.setViewOffset(w, h, offX, offY, w, h);

    // The orthographic camera sits well back so nothing near the target is clipped; its zoom
    // comes from the frustum size, matched to what the perspective camera sees at the target.
    const o = this.orthographic;
    const back = d + this.frame.radius * 4;
    const halfH = orthoHalfHeight(d, FOV);
    o.position.set(tx + dir[0] * back, ty + dir[1] * back, tz + dir[2] * back);
    o.setRotationFromMatrix(rotation);
    o.left = -halfH * (w / h);
    o.right = halfH * (w / h);
    o.top = halfH;
    o.bottom = -halfH;
    o.near = back * 1e-4;
    o.far = back + this.frame.radius * 20;
    o.setViewOffset(w, h, offX, offY, w, h);

    this.snap = this.makeSnapshot();
    this.listeners.forEach((fn) => fn());
    this.onChange();
  }
}
