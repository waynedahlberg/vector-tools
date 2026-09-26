"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Maximize, Box, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { ConvertOptions, Prepared } from "@/lib/convert";
import type { Pt } from "@/lib/geometry";

// The viewport keeps a dark CAD-style canvas in both themes, like Plasticity's.
const COLORS = {
  background: 0x17191d,
  gridMinor: 0x262a31,
  gridMajor: 0x323741,
  axisX: 0xe5484d,
  axisY: 0x46a758,
  axisZ: 0x3e8ef7,
  closed: 0x3ee6ff,
  open: 0xffb224,
  face: 0x3ee6ff,
  vertex: 0xf5f7fa,
};

const ISO_DIR = new THREE.Vector3(0.55, -1, 0.95).normalize();
const TOP_DIR = new THREE.Vector3(0, -1e-4, 1).normalize();

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
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  grid: THREE.Group;
  geometry: THREE.Group;
  resolution: THREE.Vector2;
  invalidate: () => void;
  fit: (dir?: THREE.Vector3) => void;
  frame: { center: THREE.Vector3; radius: number } | null;
};

export function Viewport3D({
  prepared,
  options,
  fileKey,
}: {
  prepared: Prepared | null;
  options: ConvertOptions;
  fileKey: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const lastFit = useRef<{ key: string; center: THREE.Vector3; radius: number } | null>(null);
  const gridLabel = prepared?.bounds ? `${+gridStepFor(prepared.bounds).toPrecision(3)} ${options.unit}` : "";

  // One-time renderer, camera and controls setup.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    lastFit.current = null; // a fresh camera always needs framing (also covers StrictMode remounts)

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      host.dataset.noWebgl = "true";
      host.textContent = "3D preview needs WebGL, which isn't available in this browser.";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(COLORS.background);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    camera.up.set(0, 0, 1); // Z-up, matching Plasticity and most CAD tools

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;

    const grid = new THREE.Group();
    const geometry = new THREE.Group();
    scene.add(grid, geometry);

    const resolution = new THREE.Vector2(1, 1);
    let needsRender = true;
    const invalidate = () => {
      needsRender = true;
    };
    controls.addEventListener("change", invalidate);

    const s: Scene = {
      renderer,
      scene,
      camera,
      controls,
      grid,
      geometry,
      resolution,
      invalidate,
      frame: null,
      fit: (dir) => {
        if (!s.frame) return;
        const { center, radius } = s.frame;
        const current = camera.position.clone().sub(controls.target);
        const d = dir ?? (current.lengthSq() > 1e-12 ? current.normalize() : ISO_DIR);
        // Fit whichever of the vertical or horizontal field of view is tighter.
        const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
        const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
        const dist = (radius / Math.tan(Math.min(vHalf, hHalf))) * 1.15;
        camera.near = dist / 1000;
        camera.far = dist * 100;
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        camera.position.copy(center).addScaledVector(d, dist);
        controls.update();
        invalidate();
      },
    };
    sceneRef.current = s;

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update(); // advances damping; fires "change" while moving
      if (!needsRender) return;
      needsRender = false;
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeGroup(grid);
      disposeGroup(geometry);
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  // Rebuild grid and geometry whenever the prepared output changes.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
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
    s.grid.add(gridLines(minorPts, COLORS.gridMinor), gridLines(majorPts, COLORS.gridMajor));

    const axisLen = Math.max(major, extent * 0.2);
    const axes: [number[], number, number][] = [
      [[-half, 0, 0, half, 0, 0], COLORS.axisX, 1.5],
      [[0, -half, 0, 0, half, 0], COLORS.axisY, 1.5],
      [[0, 0, 0, 0, 0, axisLen], COLORS.axisZ, 2],
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
        color: COLORS.face,
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

    // --- Curves: high-visibility lines, sampled exactly as exported.
    const showCurves = options.output !== "faces";
    const closedPts: number[] = [], openPts: number[] = [];
    const vertexPts: number[] = [];
    for (const pl of prepared.polylines) {
      if (!showCurves && !pl.closed) continue;
      segmentsOf(pl.pts, pl.closed ? closedPts : openPts);
      if (options.curveMode === "polyline") for (const p of pl.pts) vertexPts.push(p.x, p.y, 0);
    }
    if (closedPts.length) s.geometry.add(fatLines(closedPts, COLORS.closed, 2, s.resolution));
    if (openPts.length) s.geometry.add(fatLines(openPts, COLORS.open, 2, s.resolution));
    if (vertexPts.length && vertexPts.length / 3 <= 60000) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(vertexPts, 3));
      const points = new THREE.Points(
        g,
        new THREE.PointsMaterial({ color: COLORS.vertex, size: 3.5, sizeAttenuation: false })
      );
      points.renderOrder = 4;
      s.geometry.add(points);
    }
    s.geometry.children.forEach((c) => {
      if (c.renderOrder === 0) c.renderOrder = 3;
    });

    // Refit on a new file or when the drawing moves or rescales noticeably, but keep the
    // user's view while they only tweak settings like curve mode.
    s.frame = { center, radius };
    const prev = lastFit.current;
    const moved =
      !prev ||
      prev.key !== fileKey ||
      Math.abs(prev.radius - radius) / prev.radius > 0.05 ||
      prev.center.distanceTo(center) > prev.radius * 0.05;
    if (moved) {
      s.fit(!prev || prev.key !== fileKey ? ISO_DIR : undefined);
      lastFit.current = { key: fileKey, center, radius };
    }
    s.invalidate();
  }, [prepared, options.output, options.curveMode, options.unit, fileKey]);

  const view = (dir?: THREE.Vector3) => sceneRef.current?.fit(dir);

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4 shadow-surface-2 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[14px] font-medium text-foreground">3D preview</span>
          <span className="text-[12px] text-muted-foreground">Output geometry on the XY plane, Z up</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip content="Top view">
            <Button variant="ghost" size="icon-sm" aria-label="Top view" onClick={() => view(TOP_DIR)}>
              <Square />
            </Button>
          </Tooltip>
          <Tooltip content="Isometric view">
            <Button variant="ghost" size="icon-sm" aria-label="Isometric view" onClick={() => view(ISO_DIR)}>
              <Box />
            </Button>
          </Tooltip>
          <Tooltip content="Fit to view">
            <Button variant="ghost" size="icon-sm" aria-label="Fit to view" onClick={() => view()}>
              <Maximize />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="relative overflow-hidden rounded-xl shadow-surface-1">
        <div
          ref={hostRef}
          className="aspect-[16/10] w-full cursor-grab bg-[#17191d] active:cursor-grabbing data-[no-webgl=true]:flex data-[no-webgl=true]:cursor-default data-[no-webgl=true]:items-center data-[no-webgl=true]:justify-center data-[no-webgl=true]:text-[13px] data-[no-webgl=true]:text-white/60"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 text-[11px] text-white/55">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-[#e5484d]" />X
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-[#46a758]" />Y
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-[#3e8ef7]" />Z
            </span>
            {gridLabel && <span className="tabular-nums">Grid {gridLabel}</span>}
          </div>
          <span className="hidden text-right sm:block">Drag to orbit · Right-drag to pan · Scroll to zoom</span>
        </div>
      </div>
    </div>
  );
}
