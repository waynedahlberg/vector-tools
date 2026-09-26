"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Box, FileUp, FolderOpen, Maximize, Square, Waypoints, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import type { ConvertOptions, Prepared } from "@/lib/convert";
import { formatBytes } from "@/lib/format";
import { Dropzone, SvgFileInput, type LoadedFile } from "./dropzone";
import { GeometryView2D, OriginalView } from "./preview";
import { ProblemsList } from "./problems-list";
import type { ViewportApi } from "./viewport-3d";

// three.js only loads once a file is open, and never during prerender.
const Viewport3D = dynamic(() => import("./viewport-3d").then((m) => m.Viewport3D), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-[#17191d]" />,
});

type View = "3d" | "2d" | "original";
const VIEWS: { id: View; label: string }[] = [
  { id: "3d", label: "3D" },
  { id: "2d", label: "2D" },
  { id: "original", label: "Original" },
];
const VIEW_KEY = "svg2step:view";

function initialView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "3d" || v === "2d" || v === "original") return v;
  } catch {}
  return "3d";
}

/**
 * The main working area. With no file it's one big drop zone; with a file, the same space shows
 * the 3D preview (or the 2D and original views), with file actions above and problems below.
 */
export function Stage({
  file,
  prepared,
  options,
  errors,
  dragging,
  onFile,
  onError,
  onClose,
  onFix,
}: {
  file: LoadedFile | null;
  prepared: Prepared | null;
  options: ConvertOptions;
  errors: string[];
  /** A file is being dragged over the page while one is already open. */
  dragging: boolean;
  onFile: (f: LoadedFile) => void;
  onError: (msg: string) => void;
  onClose: () => void;
  onFix: (patch: Partial<ConvertOptions>) => void;
}) {
  const [view, setView] = useState<View>(initialView);
  const [showSeams, setShowSeams] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewport = useRef<ViewportApi | null>(null);

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  // Ctrl/Cmd+O opens a file, like a desktop app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        inputRef.current?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-4 shadow-surface-2 sm:p-5">
      <SvgFileInput inputRef={inputRef} onFile={onFile} onError={onError} />

      {file && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] font-medium text-foreground">{file.name}</span>
              <span className="text-[12px] text-muted-foreground">{formatBytes(new Blob([file.svg]).size)} SVG</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip content="Open another SVG (Ctrl+O), or drop one anywhere">
                <Button variant="secondary" size="sm" leadingIcon={FolderOpen} onClick={() => inputRef.current?.click()}>
                  Open file
                </Button>
              </Tooltip>
              <Tooltip content="Close file">
                <Button variant="ghost" size="icon-sm" aria-label="Close file" onClick={onClose}>
                  <X />
                </Button>
              </Tooltip>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <TabsSubtle selectedIndex={VIEWS.findIndex((v) => v.id === view)} onSelect={(i) => chooseView(VIEWS[i].id)} idPrefix="stage-view">
              {VIEWS.map((v, i) => (
                <TabsSubtleItem key={v.id} index={i} label={v.label} />
              ))}
            </TabsSubtle>
            {view === "3d" && (
              <div className="flex shrink-0 items-center gap-0.5">
                <Tooltip content={showSeams ? "Hide start points & direction" : "Show start points & direction"}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Show start points and direction"
                    aria-pressed={showSeams}
                    active={showSeams}
                    onClick={() => setShowSeams((v) => !v)}
                  >
                    <Waypoints />
                  </Button>
                </Tooltip>
                <Tooltip content="Face-on view">
                  <Button variant="ghost" size="icon-sm" aria-label="Face-on view" onClick={() => viewport.current?.view("face")}>
                    <Square />
                  </Button>
                </Tooltip>
                <Tooltip content="Isometric view">
                  <Button variant="ghost" size="icon-sm" aria-label="Isometric view" onClick={() => viewport.current?.view("iso")}>
                    <Box />
                  </Button>
                </Tooltip>
                <Tooltip content="Fit to view">
                  <Button variant="ghost" size="icon-sm" aria-label="Fit to view" onClick={() => viewport.current?.view("fit")}>
                    <Maximize />
                  </Button>
                </Tooltip>
              </div>
            )}
          </div>
        </>
      )}

      {/* The shared area: drop zone when empty, previews when a file is open. */}
      <div className="relative aspect-[16/10] min-h-[300px] w-full overflow-hidden rounded-xl shadow-surface-1">
        {!file ? (
          <Dropzone onFile={onFile} onError={onError} />
        ) : (
          <>
            {/* The 3D canvas stays mounted while other views show, so the camera is kept. */}
            <div className={view === "3d" ? "absolute inset-0" : "hidden"}>
              <Viewport3D
                prepared={prepared}
                options={options}
                fileKey={`${file.name}:${file.svg.length}`}
                showSeams={showSeams}
                apiRef={viewport}
              />
            </div>
            {view === "2d" && (
              <div className="absolute inset-0">
                <GeometryView2D prepared={prepared} options={options} />
              </div>
            )}
            {view === "original" && (
              <div className="absolute inset-0">
                <OriginalView svg={file.svg} />
              </div>
            )}
          </>
        )}

        {/* Always mounted and faded with CSS, so it can never outlive the drag. */}
        {file && (
          <div
            aria-hidden={!dragging}
            className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/40 bg-black/55 text-center backdrop-blur-[2px] transition-opacity duration-150 ${dragging ? "opacity-100" : "opacity-0"}`}
          >
            <FileUp className="size-7 text-white" strokeWidth={1.75} />
            <p className="text-[15px] font-medium text-white">Drop to open this SVG</p>
            <p className="text-[12px] text-white/70">It replaces the current file.</p>
          </div>
        )}
      </div>

      {file && prepared && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge size="sm" variant="dot" color="gray">
            {prepared.shapes.length} {prepared.shapes.length === 1 ? "path" : "paths"}
          </Badge>
          <Badge size="sm" variant="dot" color="blue">
            {prepared.closedCount} closed
          </Badge>
          {prepared.openCount > 0 && (
            <Badge size="sm" variant="dot" color="orange">
              {prepared.openCount} open
            </Badge>
          )}
          {options.output !== "curves" && (
            <Badge size="sm" variant="dot" color="emerald">
              {prepared.regions.length} {prepared.regions.length === 1 ? "face" : "faces"}
            </Badge>
          )}
        </div>
      )}

      {(file || errors.length > 0) && (
        <ProblemsList prepared={file ? prepared : null} options={options} errors={errors} onFix={onFix} />
      )}
    </div>
  );
}
