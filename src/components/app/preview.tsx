"use client";

import { useMemo, useState } from "react";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import type { Prepared, ConvertOptions } from "@/lib/convert";

function GeometryView({ prepared, options }: { prepared: Prepared; options: ConvertOptions }) {
  const b = prepared.bounds;
  if (!b) {
    return <p className="text-[13px] text-muted-foreground">Nothing to preview.</p>;
  }
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
      {showFaces && closedD && (
        <path d={closedD} fillRule="evenodd" className="fill-[#3b82f6]/15" stroke="none" />
      )}
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
      <g vectorEffect="non-scaling-stroke">
        <line x1={0} y1={0} x2={axis} y2={0} stroke="#ef4444" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={0} y1={0} x2={0} y2={-axis} stroke="#22c55e" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

export function Preview({
  svg,
  prepared,
  options,
}: {
  svg: string;
  prepared: Prepared | null;
  options: ConvertOptions;
}) {
  const [tab, setTab] = useState(0);
  // Rendered through <img>, so any scripts in the SVG never run.
  const url = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg]);

  const legend = useMemo(
    () => [
      { label: "Closed", swatch: "bg-foreground" },
      { label: "Open", swatch: "bg-[#f97316]" },
      ...(options.output !== "curves" ? [{ label: "Face", swatch: "bg-[#3b82f6]/30" }] : []),
    ],
    [options.output]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <TabsSubtle selectedIndex={tab} onSelect={setTab} idPrefix="preview">
          <TabsSubtleItem index={0} label="Detected geometry" />
          <TabsSubtleItem index={1} label="Original" />
        </TabsSubtle>
        {tab === 0 && (
          <div className="hidden items-center gap-3 text-[12px] text-muted-foreground sm:flex">
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${l.swatch}`} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="preview-grid relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-surface-1 p-4 shadow-surface-1">
        {tab === 0 ? (
          prepared ? (
            <GeometryView prepared={prepared} options={options} />
          ) : (
            <p className="text-[13px] text-muted-foreground">Preview unavailable.</p>
          )
        ) : (
          url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Original SVG" className="max-h-full max-w-full object-contain" />
          )
        )}
      </div>
    </div>
  );
}
