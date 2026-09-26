"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { ConvertOptions, Prepared } from "@/lib/convert";
import type { Pt } from "@/lib/geometry";
import { planeMap, type DrawingPlane } from "@/lib/step-writer";
import type { AxisKey } from "@/lib/camera";
import { polylineNodes, splineNodes } from "@/lib/nodes";
import { useIsDark } from "@/lib/appearance";
import { viewportPalette } from "@/lib/viewport-theme";
import { ISO_ANGLES, ViewController, type Insets } from "./view-controller";
import { NavGizmo } from "./nav-gizmo";

export type { Insets } from "./view-controller";

const AXIS = { x: 0xe5484d, y: 0x46a758, z: 0x3e8ef7 };

let dotTexture: THREE.Texture | null = null;
/** A soft round sprite so marker points render as dots rather than squares. */
function dot() {
  if (dotTexture) return dotTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fill();
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

function markers(points: Pt[], color: number, size: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, 0]), 3));
  const m = new THREE.PointsMaterial({
    color,
    size,
    sizeAttenuation: false,
    map: dot(),
    transparent: true,
    alphaTest: 0.5,
    depthTest: false,
  });
  const pts = new THREE.Points(g, m);
  pts.renderOrder = 10;
  return pts;
}

/** The axis view that looks straight at a drawing plane. */
const FACE_ON: Record<DrawingPlane, AxisKey> = { xy: "+z", xz: "-y", yz: "+x" };

/** 1, 2 or 5 × 10ⁿ, the usual CAD grid steps. */
function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

function gridStepFor(b: { minX: number; minY: number; maxX: number; maxY: number }) {
  return niceStep(Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-6) / 16);
}

function disposeGroup(group: THREE.Group) {
  group.traverse((o) => {
    const obj = o as THREE.Mesh;
    obj.geometry?.dispose();
    const mat = obj.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
  group.clear();
}

function fatLines(positions: number[], color: number, width: number, resolution: THREE.Vector2) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({ color, linewidth: width, worldUnits: false });
  material.resolution.copy(resolution);
  return new LineSegments2(geometry, material);
}

function segmentsOf(pts: Pt[], out: number[]) {
  for (let i = 1; i < pts.length; i++) {
    out.push(pts[i - 1].x, pts[i - 1].y, 0, pts[i].x, pts[i].y, 0);
  }
}

type Scene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  grid: THREE.Group;
  geometry: THREE.Group;
  resolution: THREE.Vector2;
  invalidate: () => void;
};

/** Camera commands for toolbars that live outside the canvas. */
export type ViewportApi = { view: (mode: "face" | "iso" | "fit") => void };

/** Beyond this many nodes the overlay would be unreadable and slow, so it isn't drawn. */
const MAX_NODES = 60000;

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The 3D preview canvas. It fills its parent; toolbars drive it through `apiRef`. */
export function Viewport3D({
  prepared,
  options,
  fileKey,
  showSeams,
  showNodes = false,
  apiRef,
  insets = NO_INSETS,
}: {
  prepared: Prepared | null;
  options: ConvertOptions;
  fileKey: string;
  showSeams: boolean;
  showNodes?: boolean;
  apiRef?: RefObject<ViewportApi | null>;
  insets?: Insets;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const dark = useIsDark();
  const lastFit = useRef<{ key: string; center: THREE.Vector3; radius: number } | null>(null);
  const planeRef = useRef(options.plane);
  // The camera controller exists for the component's lifetime; the renderer attaches to it.
  const [controller] = useState(() => new ViewController());
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    planeRef.current = options.plane;
  }, [options.plane]);

  useEffect(() => {
    controller.setInsets(insets);
  }, [controller, insets]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      view: (mode) => {
        if (mode === "face") controller.clickAxis(FACE_ON[planeRef.current]);
        else if (mode === "iso") controller.lookFrom(ISO_ANGLES);
        else controller.fit({ animate: true });
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, controller]);
  // Nodes of what's exported: open paths are left out of face-only output.
  const nodes = useMemo(() => {
    if (!prepared) return { anchors: [], handles: [] };
    const keepOpen = options.output !== "faces";
    if (options.curveMode === "polyline") return polylineNodes(prepared.polylines.filter((p) => keepOpen || p.closed));
    return splineNodes(prepared.shapes.filter((sh) => keepOpen || sh.type === "ellipse" || sh.closed));
  }, [prepared, options.output, options.curveMode]);
  const gridLabel = prepared?.bounds ? `${+gridStepFor(prepared.bounds).toPrecision(3)} ${options.unit}` : "";

  // One-time renderer setup and pointer navigation.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    lastFit.current = null; // a fresh renderer always needs framing (also covers StrictMode remounts)

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      host.dataset.noWebgl = "true";
      host.textContent = "3D preview needs WebGL, which isn't available in this browser.";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(viewportPalette(document.documentElement.classList.contains("dark")).background);
    host.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.touchAction = "none";

    const scene = new THREE.Scene();
    const grid = new THREE.Group();
    const geometry = new THREE.Group();
    scene.add(grid, geometry);

    const resolution = new THREE.Vector2(1, 1);
    let needsRender = true;
    const invalidate = () => {
      needsRender = true;
    };
    controller.setOnChange(invalidate);
    sceneRef.current = { renderer, scene, grid, geometry, resolution, invalidate };

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      controller.setSize(w, h);
      resolution.set(w, h);
      scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material;
        if (mat instanceof LineMaterial) mat.resolution.set(w, h);
      });
      invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // Left-drag orbits; right-drag, middle-drag or Shift+drag pans; the wheel zooms.
    let drag: { x: number; y: number; mode: "orbit" | "pan" } | null = null;
    const onDown = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
      drag = { x: e.clientX, y: e.clientY, mode: e.button === 0 && !e.shiftKey ? "orbit" : "pan" };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.mode === "orbit") controller.orbitBy(dx, dy);
      else controller.panBy(dx, dy);
    };
    const onUp = () => {
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      controller.zoomBy(Math.exp(-e.deltaY * 0.0015));
    };
    const onContext = (e: Event) => e.preventDefault();
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContext);

    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      controller.tick(now); // advances view animations; marks the frame dirty while moving
      if (!needsRender) return;
      needsRender = false;
      renderer.render(scene, controller.camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
      disposeGroup(grid);
      disposeGroup(geometry);
      renderer.dispose();
      canvas.remove();
      sceneRef.current = null;
      controller.setOnChange(() => {});
    };
  }, [controller]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.renderer.setClearColor(viewportPalette(dark).background);
    s.invalidate();
  }, [dark]);

  // Rebuild grid and geometry whenever the prepared output changes.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const palette = viewportPalette(dark);
    disposeGroup(s.grid);
    disposeGroup(s.geometry);
    const b = prepared?.bounds;
    if (!prepared || !b) {
      s.invalidate();
      return;
    }

    const width = b.maxX - b.minX, height = b.maxY - b.minY;
    const extent = Math.max(width, height, 1e-6);
    const center = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0);
    const radius = extent / 2;

    // --- Grid: minor/major lines on the XY plane, covering the drawing and the origin.
    const minor = gridStepFor(b);
    const major = minor * 5;
    const reach = Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minY), Math.abs(b.maxY)) * 1.25 + major;
    const half = Math.ceil(reach / major) * major;
    const minorPts: number[] = [], majorPts: number[] = [];
    const count = Math.round(half / minor);
    for (let i = -count; i <= count; i++) {
      if (i === 0) continue; // the axes draw the zero lines
      const v = i * minor;
      const target = i % 5 === 0 ? majorPts : minorPts;
      target.push(v, -half, 0, v, half, 0, -half, v, 0, half, v, 0);
    }
    const gridLines = (pts: number[], color: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthWrite: false }));
      lines.renderOrder = 0;
      return lines;
    };
    s.grid.add(gridLines(minorPts, palette.gridMinor), gridLines(majorPts, palette.gridMajor));

    const axisLen = Math.max(major, extent * 0.2);
    const axes: [number[], number, number][] = [
      [[-half, 0, 0, half, 0, 0], AXIS.x, 1.5],
      [[0, -half, 0, 0, half, 0], AXIS.y, 1.5],
      [[0, 0, 0, 0, 0, axisLen], AXIS.z, 2],
    ];
    for (const [pts, color, w] of axes) {
      const line = fatLines(pts, color, w, s.resolution);
      (line.material as LineMaterial).transparent = true;
      (line.material as LineMaterial).opacity = 0.75;
      line.renderOrder = 1;
      s.grid.add(line);
    }

    // --- Faces: translucent fill with holes, as they'll import.
    if (options.output !== "curves") {
      const material = new THREE.MeshBasicMaterial({
        color: palette.face,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      for (const r of prepared.regionPolys) {
        if (r.outer.length < 3) continue;
        const shape = new THREE.Shape(r.outer.map((p) => new THREE.Vector2(p.x, p.y)));
        for (const h of r.holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
        mesh.renderOrder = 2;
        s.geometry.add(mesh);
      }
    }

    // --- Ghost: the geometry before outlining/cleanup, thin and dim underneath the output.
    if (prepared.ghost.length) {
      const pts: number[] = [];
      for (const poly of prepared.ghost) segmentsOf(poly, pts);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const ghost = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: palette.ghost, transparent: true, opacity: 0.9, depthWrite: false })
      );
      ghost.renderOrder = 2;
      s.geometry.add(ghost);
    }

    // --- Curves: high-visibility lines, sampled exactly as exported.
    const showCurves = options.output !== "faces";
    const closedPts: number[] = [], openPts: number[] = [];
    for (const pl of prepared.polylines) {
      if (!showCurves && !pl.closed) continue;
      segmentsOf(pl.pts, pl.closed ? closedPts : openPts);
    }
    if (closedPts.length) s.geometry.add(fatLines(closedPts, palette.closed, 2, s.resolution));
    if (openPts.length) s.geometry.add(fatLines(openPts, palette.open, 2, s.resolution));
    s.geometry.children.forEach((c) => {
      if (c.renderOrder === 0) c.renderOrder = 3;
    });

    // --- Nodes: spline anchors and Bézier handles, or the exported polyline vertices.
    if (showNodes && nodes.anchors.length <= MAX_NODES) {
      if (nodes.handles.length) {
        const pts: number[] = [];
        for (const [a, b] of nodes.handles) pts.push(a.x, a.y, 0, b.x, b.y, 0);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        const lines = new THREE.LineSegments(
          g,
          new THREE.LineBasicMaterial({ color: palette.handle, transparent: true, opacity: 0.75, depthTest: false })
        );
        lines.renderOrder = 7;
        s.geometry.add(lines, markers(nodes.handles.map(([, b]) => b), palette.handle, 4));
      }
      s.geometry.add(markers(nodes.anchors, palette.vertex, 5.5));
    }

    // --- Problem markers and the optional seam/direction overlay.
    const { problems, repairs } = prepared;
    if (problems.openEnds.length) s.geometry.add(markers(problems.openEnds, palette.openEnd, 7));
    if (repairs.joins.length) s.geometry.add(markers(repairs.joins, palette.join, 8));
    if (problems.selfIntersections.length) s.geometry.add(markers(problems.selfIntersections, palette.selfIntersection, 9));
    if (showSeams && prepared.seams.length) {
      const len = extent * 0.025;
      const arrows: number[] = [];
      for (const { at, dir } of prepared.seams) {
        const tip = { x: at.x + dir.x * len, y: at.y + dir.y * len };
        arrows.push(at.x, at.y, 0, tip.x, tip.y, 0);
        for (const side of [1, -1]) {
          const a = Math.PI * 0.82 * side;
          const wx = dir.x * Math.cos(a) - dir.y * Math.sin(a), wy = dir.x * Math.sin(a) + dir.y * Math.cos(a);
          arrows.push(tip.x, tip.y, 0, tip.x + wx * len * 0.4, tip.y + wy * len * 0.4, 0);
        }
      }
      const arrowLines = fatLines(arrows, palette.seam, 2, s.resolution);
      (arrowLines.material as LineMaterial).depthTest = false;
      arrowLines.renderOrder = 9;
      s.geometry.add(arrowLines, markers(prepared.seams.map((q) => q.at), palette.seam, 6));
    }

    // Lay the drawing on its plane. The grid stays on the XY ground plane.
    const map = planeMap(options.plane);
    s.geometry.setRotationFromMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...map.to3(1, 0)),
        new THREE.Vector3(...map.to3(0, 1)),
        new THREE.Vector3(...map.normal)
      )
    );
    center.set(...map.to3(center.x, center.y));

    // Refit on a new file or when the drawing moves or rescales noticeably, but keep the
    // user's view while they only tweak settings like curve mode.
    controller.setFrame([center.x, center.y, center.z], radius);
    const prev = lastFit.current;
    const moved =
      !prev ||
      prev.key !== fileKey ||
      Math.abs(prev.radius - radius) / prev.radius > 0.05 ||
      prev.center.distanceTo(center) > prev.radius * 0.05;
    if (moved) {
      controller.fit({ angles: !prev || prev.key !== fileKey ? ISO_ANGLES : undefined });
      lastFit.current = { key: fileKey, center, radius };
    }
    s.invalidate();
  }, [prepared, options.output, options.curveMode, options.unit, options.plane, fileKey, showSeams, showNodes, nodes, controller, dark]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--viewport-bg)]">
      <div
        ref={hostRef}
        className="h-full w-full cursor-default data-[no-webgl=true]:flex data-[no-webgl=true]:cursor-default data-[no-webgl=true]:items-center data-[no-webgl=true]:justify-center data-[no-webgl=true]:text-[13px] data-[no-webgl=true]:text-[color:var(--viewport-ink)]"
      />
      <div
        className="pointer-events-none absolute flex items-end justify-between gap-3 p-3 text-[11px] text-[color:var(--viewport-ink)]"
        style={{ left: insets.left, right: insets.right, bottom: insets.bottom }}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-[#e5484d]" />X
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-[#46a758]" />Y
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-[#3e8ef7]" />Z
          </span>
          <span className="text-[color:var(--viewport-ink-strong)]">{snap.name}</span>
          <span>{options.plane.toUpperCase()} plane</span>
          {gridLabel && <span className="tabular-nums">Grid {gridLabel}</span>}
          {!!prepared?.problems.openEnds.length && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#ffb224]" />Open end
            </span>
          )}
          {!!prepared?.problems.selfIntersections.length && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#ff4d4f]" />Crossing
            </span>
          )}
          {showNodes && (
            <span className="flex items-center gap-1.5 tabular-nums">
              <span className="size-2 rounded-full bg-[var(--viewport-vertex)] ring-1 ring-foreground/15" />
              {nodes.anchors.length > MAX_NODES
                ? `${nodes.anchors.length.toLocaleString()} nodes (too many to draw)`
                : `${nodes.anchors.length.toLocaleString()} ${nodes.anchors.length === 1 ? "node" : "nodes"}`}
            </span>
          )}
          {!!prepared?.ghost.length && (
            <span className="flex items-center gap-1.5">
              <span className="h-px w-3 bg-[#6b7280]" />Original
            </span>
          )}
          {!!prepared?.repairs.joins.length && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#30d158]" />Joined
            </span>
          )}
        </div>
        <span className="hidden shrink-0 text-right 2xl:block">Drag to orbit · Right-drag to pan · Scroll to zoom</span>
      </div>
      <NavGizmo controller={controller} dark={dark} style={{ top: insets.top + 4, right: insets.right + 12 }} />
    </div>
  );
}
