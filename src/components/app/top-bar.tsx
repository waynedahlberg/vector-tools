"use client";

import { Box, FileCode2, FolderOpen, Maximize, Redo2, RotateCcw, Spline, Square, Undo2, Waypoints, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { formatBytes } from "@/lib/format";
import { AppearanceToggle } from "./appearance-toggle";
import type { LoadedFile } from "./dropzone";
import type { View } from "./stage";

const VIEWS: { id: View; label: string }[] = [
  { id: "3d", label: "3D" },
  { id: "2d", label: "2D" },
  { id: "original", label: "Original" },
];

const bar = "pointer-events-auto flex h-12 items-center rounded-2xl panel-glass shadow-surface-6";

/**
 * Floating bar across the top: the file (left, above the Source panel), view switching and 3D
 * camera tools (centre), and undo/redo/reset (right, above the Output panel).
 */
export function TopBar({
  file,
  onOpen,
  onClose,
  view,
  onView,
  showSeams,
  onToggleSeams,
  showNodes,
  onToggleNodes,
  onCamera,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  geometryModified,
  onResetGeometry,
}: {
  file: LoadedFile | null;
  onOpen: () => void;
  onClose: () => void;
  view: View;
  onView: (v: View) => void;
  showSeams: boolean;
  onToggleSeams: () => void;
  showNodes: boolean;
  onToggleNodes: () => void;
  onCamera: (mode: "face" | "iso" | "fit") => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  geometryModified: boolean;
  onResetGeometry: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 flex items-start justify-between gap-4">
      <div className={`${bar} w-[320px] shrink-0 gap-2.5 pl-2.5 pr-1.5`}>
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
          <FileCode2 className="size-3.5" strokeWidth={2} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          {file ? (
            <>
              <span className="truncate text-[13px] font-medium text-foreground" title={file.name}>
                {file.name}
              </span>
              <span className="text-[11px] text-muted-foreground">{formatBytes(new Blob([file.svg]).size)} SVG</span>
            </>
          ) : (
            <>
              <span className="text-[13px] font-semibold text-foreground">SVG to STEP</span>
              <span className="text-[11px] text-muted-foreground">Runs locally in your browser</span>
            </>
          )}
        </div>
        <Tooltip content="Open an SVG (Ctrl+O), or drop one anywhere">
          <Button variant={file ? "ghost" : "secondary"} size="sm" leadingIcon={FolderOpen} onClick={onOpen}>
            {file ? "Open" : "Open file"}
          </Button>
        </Tooltip>
        {file && (
          <Tooltip content="Close file">
            <Button variant="ghost" size="icon-sm" aria-label="Close file" onClick={onClose}>
              <X />
            </Button>
          </Tooltip>
        )}
      </div>

      {file && (
        <div className={`${bar} gap-1 px-1.5`}>
          <TabsSubtle selectedIndex={VIEWS.findIndex((v) => v.id === view)} onSelect={(i) => onView(VIEWS[i].id)} idPrefix="stage-view">
            {VIEWS.map((v, i) => (
              <TabsSubtleItem key={v.id} index={i} label={v.label} />
            ))}
          </TabsSubtle>
          {view === "3d" && (
            <>
              <span className="mx-1 h-5 w-px bg-border" aria-hidden />
              <Tooltip content={showNodes ? "Hide nodes" : "Show nodes and handles"}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Show nodes"
                  aria-pressed={showNodes}
                  active={showNodes}
                  onClick={onToggleNodes}
                >
                  <Spline />
                </Button>
              </Tooltip>
              <Tooltip content={showSeams ? "Hide start points & direction" : "Show start points & direction"}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Show start points and direction"
                  aria-pressed={showSeams}
                  active={showSeams}
                  onClick={onToggleSeams}
                >
                  <Waypoints />
                </Button>
              </Tooltip>
              <Tooltip content="Face-on view">
                <Button variant="ghost" size="icon-sm" aria-label="Face-on view" onClick={() => onCamera("face")}>
                  <Square />
                </Button>
              </Tooltip>
              <Tooltip content="Isometric view">
                <Button variant="ghost" size="icon-sm" aria-label="Isometric view" onClick={() => onCamera("iso")}>
                  <Box />
                </Button>
              </Tooltip>
              <Tooltip content="Fit to view">
                <Button variant="ghost" size="icon-sm" aria-label="Fit to view" onClick={() => onCamera("fit")}>
                  <Maximize />
                </Button>
              </Tooltip>
            </>
          )}
        </div>
      )}

      <div className={`${bar} w-[340px] shrink-0 justify-end gap-0.5 px-1.5`}>
        <AppearanceToggle />
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <Tooltip content="Turn off every geometry change (repair, outlines, cleanup, hidden layers)">
          <Button variant="ghost" size="sm" leadingIcon={RotateCcw} disabled={!geometryModified} onClick={onResetGeometry}>
            Reset geometry
          </Button>
        </Tooltip>
        <Tooltip content="Undo (Ctrl+Z)">
          <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
            <Undo2 />
          </Button>
        </Tooltip>
        <Tooltip content="Redo (Ctrl+Shift+Z)">
          <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
            <Redo2 />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
