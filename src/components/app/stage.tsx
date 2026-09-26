"use client";

import dynamic from "next/dynamic";
import type { RefObject } from "react";
import { FileUp } from "lucide-react";
import type { ConvertOptions, Prepared } from "@/lib/convert";
import { Dropzone, type LoadedFile } from "./dropzone";
import { GeometryView2D, OriginalView } from "./preview";
import type { Insets, ViewportApi } from "./viewport-3d";

// three.js only loads once a file is open, and never during prerender.
const Viewport3D = dynamic(() => import("./viewport-3d").then((m) => m.Viewport3D), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-[var(--viewport-bg)]" />,
});

export type View = "3d" | "2d" | "original";

/**
 * The full-window background. With no file it's the drop zone; with a file it's the 3D, 2D or
 * original view. Panels float over it, so content is kept inside `insets`.
 */
export function Stage({
  file,
  prepared,
  options,
  view,
  showSeams,
  showNodes,
  viewportApi,
  insets,
  dragging,
  onFile,
  onError,
}: {
  file: LoadedFile | null;
  prepared: Prepared | null;
  options: ConvertOptions;
  view: View;
  showSeams: boolean;
  showNodes: boolean;
  viewportApi: RefObject<ViewportApi | null>;
  insets: Insets;
  dragging: boolean;
  onFile: (f: LoadedFile) => void;
  onError: (msg: string) => void;
}) {
  const gap = { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left };

  return (
    <div className="absolute inset-0 bg-[var(--viewport-bg)]">
      {!file ? (
        <div className="absolute" style={gap}>
          <Dropzone onFile={onFile} onError={onError} />
        </div>
      ) : (
        <>
          {/* The 3D canvas spans the whole window and stays mounted while other views show, so
              the camera is kept. It offsets its own projection to centre in the gap. */}
          <div className={view === "3d" ? "absolute inset-0" : "hidden"}>
            <Viewport3D
              prepared={prepared}
              options={options}
              fileKey={`${file.name}:${file.svg.length}`}
              showSeams={showSeams}
              showNodes={showNodes}
              apiRef={viewportApi}
              insets={insets}
            />
          </div>
          {view !== "3d" && (
            <div className="preview-grid absolute inset-0 bg-surface-1">
              <div className="absolute" style={gap}>
                {view === "2d" ? <GeometryView2D prepared={prepared} options={options} /> : <OriginalView svg={file.svg} />}
              </div>
            </div>
          )}
        </>
      )}

      {/* Always mounted and faded with CSS, so it can never outlive the drag. */}
      {file && (
        <div
          aria-hidden={!dragging}
          style={gap}
          className={`pointer-events-none absolute flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/40 bg-black/55 text-center backdrop-blur-[2px] transition-opacity duration-150 ${dragging ? "opacity-100" : "opacity-0"}`}
        >
          <FileUp className="size-7 text-white" strokeWidth={1.75} />
          <p className="text-[15px] font-medium text-white">Drop to open this SVG</p>
          <p className="text-[12px] text-white/70">It replaces the current file.</p>
        </div>
      )}
    </div>
  );
}
