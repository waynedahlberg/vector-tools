"use client";

import type { ReactNode } from "react";
import { Box, FileCode2, FolderOpen, ImageUpscale, Maximize, Redo2, RotateCcw, Spline, Square, Undo2, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { AppearanceToggle } from "./appearance-toggle";

export type Mode = "svg" | "vectorize";

export const MODES: { id: Mode; title: string; short: string; icon: typeof FileCode2; empty: string }[] = [
  { id: "svg", title: "STEP Convert", short: "STEP Convert", icon: FileCode2, empty: "Convert SVG artwork to STEP for CAD" },
  { id: "vectorize", title: "Vectorize", short: "Vectorize", icon: ImageUpscale, empty: "Trace images into SVG vector paths" },
];

const bar = "pointer-events-auto flex h-12 items-center rounded-2xl panel-glass shadow-surface-6";

/**
 * Floating bar across the top: the mode switch and Open (left, above the left panel), view switching
 * and view tools (centre), and undo/redo/reset (right, above the right panel). What each part
 * shows depends on the mode; the parent supplies it.
 */
export function TopBar<V extends string>({
  mode,
  onMode,
  file,
  onOpen,
  views,
  view,
  onView,
  tools,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  reset,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  /** Whether a file is open; its name and Close live in the left panel's header. */
  file: boolean;
  onOpen: () => void;
  views: { id: V; label: string }[];
  view: V;
  onView: (v: V) => void;
  /** Extra controls after the view tabs, e.g. 3D camera buttons. */
  tools?: ReactNode;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  reset: { label: string; tooltip: string; disabled: boolean; onClick: () => void };
}) {
  const noun = mode === "svg" ? "an SVG" : "an image";

  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 flex items-start justify-between gap-4">
      <div className={`${bar} w-[320px] shrink-0 gap-1 pl-1.5 pr-1.5`}>
        <TabsSubtle
          aria-label="Mode"
          className="min-w-0 flex-1 justify-start"
          selectedIndex={MODES.findIndex((m) => m.id === mode)}
          onSelect={(i) => onMode(MODES[i].id)}
          idPrefix="mode"
        >
          {MODES.map((m, i) => (
            <TabsSubtleItem key={m.id} index={i} icon={m.icon} label={m.short} title={m.empty} />
          ))}
        </TabsSubtle>
        <Tooltip content={`Open ${noun} (Ctrl+O), or drop one anywhere`}>
          <Button variant={file ? "ghost" : "secondary"} size="icon-sm" aria-label={`Open ${noun}`} onClick={onOpen}>
            <FolderOpen />
          </Button>
        </Tooltip>
      </div>

      {file && (
        <div className={`${bar} gap-1 px-1.5`}>
          <TabsSubtle
            selectedIndex={views.findIndex((v) => v.id === view)}
            onSelect={(i) => onView(views[i].id)}
            idPrefix={`${mode}-view`}
          >
            {views.map((v, i) => (
              <TabsSubtleItem key={v.id} index={i} label={v.label} />
            ))}
          </TabsSubtle>
          {tools}
        </div>
      )}

      <div className={`${bar} w-[340px] shrink-0 justify-end gap-0.5 px-1.5`}>
        <AppearanceToggle />
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <Tooltip content={reset.tooltip}>
          <Button variant="ghost" size="sm" leadingIcon={RotateCcw} disabled={reset.disabled} onClick={reset.onClick}>
            {reset.label}
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

/** 3D view toggles and camera buttons for STEP Convert's 3D view. */
export function ViewTools3D({
  showNodes,
  onToggleNodes,
  showSeams,
  onToggleSeams,
  onCamera,
}: {
  showNodes: boolean;
  onToggleNodes: () => void;
  showSeams: boolean;
  onToggleSeams: () => void;
  onCamera: (mode: "face" | "iso" | "fit") => void;
}) {
  return (
    <>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Tooltip content={showNodes ? "Hide nodes" : "Show nodes and handles"}>
        <Button variant="ghost" size="icon-sm" aria-label="Show nodes" aria-pressed={showNodes} active={showNodes} onClick={onToggleNodes}>
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
  );
}
