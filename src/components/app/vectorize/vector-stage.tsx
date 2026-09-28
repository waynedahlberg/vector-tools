"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Loader2, Maximize } from "lucide-react";
import { Dropzone } from "../dropzone";
import type { Insets } from "../viewport-3d";
import { hex, layerD } from "@/lib/vectorize/svg";
import { IMAGE_ACCEPT, readImageFile, type LoadedImage, type Vectorizer } from "./use-vectorizer";

export type VectorView = "traced" | "outlines" | "original";

const IMAGE_COPY = {
  title: "Drop an image to trace",
  dropping: "Release to trace the image",
  detail: "PNG, JPEG, WebP, GIF, BMP or AVIF. Traced in your browser; nothing is uploaded.",
  ariaLabel: "Drop an image here, or press Enter to choose one",
};

type ViewTransform = { s: number; x: number; y: number };
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 64;

/**
 * The full-window background in Vectorize mode: the drop zone, or the image and its trace
 * on a pannable, zoomable canvas. Drawn as live SVG, so edges stay sharp at any zoom.
 */
export function VectorStage({
  v,
  view,
  insets,
  dragging,
  onImage,
  onError,
}: {
  v: Vectorizer;
  view: VectorView;
  insets: Insets;
  dragging: boolean;
  onImage: (img: LoadedImage) => void;
  onError: (msg: string) => void;
}) {
  const gap = { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left };

  return (
    <div className="absolute inset-0 bg-[var(--viewport-bg)]">
      {!v.image ? (
        <div className="absolute" style={gap}>
          <Dropzone<LoadedImage> onFile={onImage} onError={onError} accept={IMAGE_ACCEPT} read={readImageFile} copy={IMAGE_COPY} />
        </div>
      ) : (
        <Canvas key={v.image.key} v={v} image={v.image} view={view} insets={insets} />
      )}
      {v.image && (
        <div
          aria-hidden={!dragging}
          style={gap}
          className={`pointer-events-none absolute flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/40 bg-black/55 text-center backdrop-blur-[2px] transition-opacity duration-150 ${dragging ? "opacity-100" : "opacity-0"}`}
        >
          <FileUp className="size-7 text-white" strokeWidth={1.75} />
          <p className="text-[15px] font-medium text-white">Drop to trace this file</p>
          <p className="text-[12px] text-white/70">Images replace the current one; SVGs open in STEP Convert.</p>
        </div>
      )}
    </div>
  );
}

function useNaturalSize(url: string) {
  const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setSize({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.src = url;
    return () => {
      img.onload = null;
    };
  }, [url]);
  return size?.url === url ? size : null;
}

function Canvas({ v, image, view, insets }: { v: Vectorizer; image: LoadedImage; view: VectorView; insets: Insets }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const natural = useNaturalSize(image.url);
  const result = v.outcome?.result;
  // Everything is drawn in the traced image's pixel space; before the first trace, the original's.
  const docW = result?.width ?? natural?.width ?? 0;
  const docH = result?.height ?? natural?.height ?? 0;
  const doc = docW && docH ? { width: docW, height: docH } : null;

  // Until the user pans or zooms, the view is fitted to the gap between the panels and follows
  // the window and the drawing; after that it's theirs. Double-click fits again.
  const [manual, setManual] = useState<ViewTransform | null>(null);
  const fitted = useMemo((): ViewTransform => {
    if (!docW || !docH || !box.width) return { s: 1, x: 0, y: 0 };
    const aw = Math.max(1, box.width - insets.left - insets.right);
    const ah = Math.max(1, box.height - insets.top - insets.bottom);
    const s = Math.min(aw / docW, ah / docH) * 0.92;
    return { s, x: insets.left + (aw - docW * s) / 2, y: insets.top + (ah - docH * s) / 2 };
  }, [docW, docH, box.width, box.height, insets.left, insets.right, insets.top, insets.bottom]);
  const t = manual ?? fitted;
  const current = useRef(t);
  useEffect(() => {
    current.current = t;
  });
  const move = useCallback((f: (p: ViewTransform) => ViewTransform) => setManual(f(current.current)), []);
  const fit = () => setManual(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel zooms around the cursor. Registered by hand because React's wheel listener is passive.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      move((p) => {
        const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.s * factor));
        const k = s / p.s;
        return { s, x: px - (px - p.x) * k, y: py - (py - p.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [move]);

  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    move((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const layers = v.derived?.visible;
  const paths = useMemo(
    () => layers?.map((l, i) => ({ key: i, d: layerD(l), fill: hex(l.color) })) ?? [],
    [layers]
  );
  const traced = useMemo(
    () => paths.map((p) => <path key={p.key} d={p.d} fill={p.fill} fillRule="evenodd" />),
    [paths]
  );
  const outlines = useMemo(
    () => (
      <path
        d={paths.map((p) => p.d).join("")}
        fill="none"
        stroke="#2563eb"
        strokeWidth={1}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    ),
    [paths]
  );

  const showSpinner = useDelayed(v.status === "tracing", 250);
  const checker = 8 / t.s;

  return (
    <div
      ref={ref}
      className="preview-grid absolute inset-0 cursor-grab touch-none select-none bg-surface-1 active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={fit}
    >
      {doc && (
        <svg className="absolute inset-0 h-full w-full" role="img" aria-label={`${image.name}, ${view} view`}>
          <defs>
            <pattern id="vs-checker" width={checker * 2} height={checker * 2} patternUnits="userSpaceOnUse">
              <rect width={checker * 2} height={checker * 2} fill="#ffffff" />
              <rect width={checker} height={checker} fill="#e5e7eb" />
              <rect x={checker} y={checker} width={checker} height={checker} fill="#e5e7eb" />
            </pattern>
          </defs>
          <g transform={`translate(${t.x} ${t.y}) scale(${t.s})`}>
            <rect width={doc.width} height={doc.height} fill="url(#vs-checker)" />
            {(view === "original" || view === "outlines" || !result) && (
              <image
                href={image.url}
                width={doc.width}
                height={doc.height}
                preserveAspectRatio="none"
                opacity={view === "outlines" ? 0.35 : 1}
                style={{ imageRendering: t.s > 3 ? "pixelated" : "auto" }}
              />
            )}
            {view === "traced" && traced}
            {view === "outlines" && outlines}
          </g>
        </svg>
      )}

      <div
        className="pointer-events-none absolute flex justify-center"
        style={{ left: insets.left, right: insets.right, bottom: insets.bottom + 8 }}
      >
        <div className="pointer-events-auto flex h-9 items-center gap-1 rounded-full panel-glass px-1.5 shadow-surface-6">
          {showSpinner && (
            <span className="flex items-center gap-1.5 px-2 text-[12px] text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" />
              Tracing…
            </span>
          )}
          <span className="px-2 text-[12px] tabular-nums text-muted-foreground">{Math.round(t.s * 100)}%</span>
          <button
            type="button"
            onClick={fit}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Fit to view"
            title="Fit to view (double-click)"
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <Maximize className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** True once `value` has stayed true for `ms`, so quick traces don't flash a spinner. */
function useDelayed(value: boolean, ms: number) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(value), value ? ms : 0);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return value && shown;
}
