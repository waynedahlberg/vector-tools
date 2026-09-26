"use client";

import { useMemo } from "react";
import type { Prepared, ConvertOptions } from "@/lib/convert";

/** Flat, top-down view of the detected output geometry. Fills its parent. */
export function GeometryView2D({ prepared, options }: { prepared: Prepared | null; options: ConvertOptions }) {
  const b = prepared?.bounds;
  const legend = [
    { label: "Closed", swatch: "bg-foreground" },
    { label: "Open", swatch: "bg-[#f97316]" },
    ...(options.output !== "curves" ? [{ label: "Face", swatch: "bg-[#3b82f6]/30" }] : []),
  ];

  return (
    <div className="preview-grid relative flex h-full w-full items-center justify-center bg-surface-1 p-6">
      {!prepared || !b ? (
        <p className="text-[13px] text-muted-foreground">Nothing to preview.</p>
      ) : (
        <Drawing prepared={prepared} options={options} />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-3 p-3 text-[11px] text-muted-foreground">
        {legend.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${l.swatch}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Drawing({ prepared, options }: { prepared: Prepared; options: ConvertOptions }) {
  const b = prepared.bounds!;
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxY - b.minY, 1e-6);
  const pad = Math.max(w, h) * 0.06;
  // Display coordinates flip Y back, so the drawing reads upright on screen.
  const vb = [b.minX - pad, -b.maxY - pad, w + pad * 2, h + pad * 2];
  const axis = Math.max(w, h) * 0.08;
  const showFaces = options.output !== "curves";
  const closedD = prepared.previewPaths.filter((p) => p.closed).map((p) => p.d).join(" ");

  return (
    <svg viewBox={vb.join(" ")} className="h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Detected geometry">
      {showFaces && closedD && <path d={closedD} fillRule="evenodd" className="fill-[#3b82f6]/15" stroke="none" />}
      {prepared.previewPaths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          vectorEffect="non-scaling-stroke"
          strokeWidth={1.25}
          strokeLinejoin="round"
          className={p.closed ? "stroke-foreground" : "stroke-[#f97316]"}
          strokeDasharray={p.closed ? undefined : "4 3"}
        />
      ))}
      {/* Origin marker: X in red, Y in green, as in most CAD tools. */}
      <line x1={0} y1={0} x2={axis} y2={0} stroke="#ef4444" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <line x1={0} y1={0} x2={0} y2={-axis} stroke="#22c55e" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The uploaded artwork as the browser renders it. Fills its parent. */
export function OriginalView({ svg }: { svg: string }) {
  // Rendered through <img>, so any scripts in the SVG never run.
  const url = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg]);
  return (
    <div className="preview-grid flex h-full w-full items-center justify-center bg-surface-1 p-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Original SVG" className="max-h-full max-w-full object-contain" />
    </div>
  );
}
