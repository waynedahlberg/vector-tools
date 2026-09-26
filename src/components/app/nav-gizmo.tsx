"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Grid3x3, Hand, ZoomIn } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { projectAxes, type AxisKey } from "@/lib/camera";
import { cn } from "@/lib/utils";
import type { ViewController } from "./view-controller";

/** Capture the pointer for a drag; harmless if the browser refuses (e.g. synthetic events). */
function capture(e: React.PointerEvent<Element>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {}
}

// Blender's gizmo colours.
const AXIS_COLOR: Record<"x" | "y" | "z", string> = { x: "#ff3352", y: "#8bdc00", z: "#2890ff" };
/** Opaque blend of an axis colour into the viewport background, for the negative-axis balls. */
function darken(hex: string, amount = 0.3) {
  const bg = [0x17, 0x19, 0x1d];
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${c.map((v, i) => Math.round(v * amount + bg[i] * (1 - amount))).join(",")})`;
}

const SIZE = 104;
const C = SIZE / 2;
const REACH = 34;
const BALL = 9;

type Ball = { key: AxisKey; x: number; y: number; depth: number; positive: boolean; color: string };

function balls(view: ReturnType<ViewController["getSnapshot"]>["view"]): Ball[] {
  const p = projectAxes(view);
  return (Object.keys(p) as AxisKey[])
    .map((key) => ({
      key,
      x: C + p[key].x * REACH,
      y: C - p[key].y * REACH,
      depth: p[key].depth,
      positive: key[0] === "+",
      color: AXIS_COLOR[key[1] as "x" | "y" | "z"],
    }))
    .sort((a, b) => a.depth - b.depth); // far first, so near balls draw on top
}

/**
 * Blender-style navigation gizmo: click an axis to animate to that view (click it again for the
 * opposite side), drag to orbit. Below it: drag-to-zoom, drag-to-pan, and perspective toggle.
 */
export function NavGizmo({ controller, style }: { controller: ViewController; style: React.CSSProperties }) {
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [hover, setHover] = useState<AxisKey | "gizmo" | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const list = balls(snap.view);

  const hit = (e: React.PointerEvent<SVGSVGElement>): Ball | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    // Nearest-to-viewer ball under the pointer wins.
    return [...list].reverse().find((b) => Math.hypot(b.x - x, b.y - y) <= BALL + 2) ?? null;
  };

  return (
    <div className="pointer-events-none absolute flex flex-col items-center gap-3" style={style}>
      <svg
        width={SIZE}
        height={SIZE}
        role="toolbar"
        aria-label={`View: ${snap.name}. Click an axis to view along it, drag to orbit.`}
        data-view={snap.name}
        data-yaw={snap.view.yaw.toFixed(4)}
        data-pitch={snap.view.pitch.toFixed(4)}
        data-ortho={snap.ortho}
        data-dist={snap.view.dist.toFixed(4)}
        data-target={snap.view.target.map((v) => v.toFixed(4)).join(",")}
        className="pointer-events-auto cursor-pointer touch-none select-none"
        onPointerDown={(e) => {
          capture(e);
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) {
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (!d.moved && Math.hypot(dx, dy) < 3) return;
            d.moved = true;
            controller.orbitBy(dx, dy);
            d.x = e.clientX;
            d.y = e.clientY;
            return;
          }
          setHover(hit(e)?.key ?? "gizmo");
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const b = hit(e);
            if (b) controller.clickAxis(b.key);
          }
        }}
        onPointerLeave={() => {
          if (!drag.current) setHover(null);
        }}
      >
        <circle cx={C} cy={C} r={C - 2} fill="white" opacity={hover ? 0.1 : 0} style={{ transition: "opacity 120ms" }} />
        {list.map((b) =>
          b.positive ? (
            <line key={`l${b.key}`} x1={C} y1={C} x2={b.x} y2={b.y} stroke={b.color} strokeWidth={2} strokeLinecap="round" />
          ) : null
        )}
        {list.map((b) => {
          const hovered = hover === b.key;
          return (
            <g key={b.key}>
              <circle
                cx={b.x}
                cy={b.y}
                r={BALL}
                fill={b.positive ? b.color : darken(b.color)}
                stroke={hovered ? "white" : b.positive ? "none" : b.color}
                strokeWidth={hovered ? 2 : 1.5}
              />
              {/* Negative axes are labelled when hovered or pointing at the viewer, as in Blender. */}
              {(b.positive || hovered || b.depth > 0.9) && (
                <text
                  x={b.x}
                  y={b.y}
                  dy="0.35em"
                  textAnchor="middle"
                  fontSize={b.positive ? 11 : 9}
                  fontWeight={700}
                  fill={b.positive ? "#0b0b0e" : "white"}
                  style={{ pointerEvents: "none" }}
                >
                  {b.positive ? b.key[1].toUpperCase() : `-${b.key[1].toUpperCase()}`}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-auto flex flex-col gap-1 rounded-full bg-black/35 p-1 backdrop-blur-sm">
        <DragTool
          label="Zoom: drag up or down"
          onDrag={(_, dy) => controller.zoomBy(Math.exp(-dy * 0.01))}
          icon={<ZoomIn className="size-[18px]" />}
        />
        <DragTool label="Pan: drag to move the view" onDrag={(dx, dy) => controller.panBy(dx, dy)} icon={<Hand className="size-[18px]" />} />
        <Tooltip content={snap.ortho ? "Switch to perspective" : "Switch to orthographic"} side="left" delayDuration={0}>
          <button
            type="button"
            aria-label="Toggle perspective / orthographic"
            aria-pressed={snap.ortho}
            onClick={() => controller.toggleOrtho()}
            className={cn(
              "flex size-9 items-center justify-center rounded-full text-white/80 outline-none transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60",
              snap.ortho && "bg-white/20 text-white"
            )}
          >
            <Grid3x3 className="size-[18px]" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

/** A Blender-style tool button you press and drag on (zoom and pan). */
function DragTool({ label, icon, onDrag }: { label: string; icon: React.ReactNode; onDrag: (dx: number, dy: number) => void }) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(false);
  return (
    <Tooltip content={label} side="left" delayDuration={0}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          "flex size-9 cursor-grab touch-none items-center justify-center rounded-full text-white/80 outline-none transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60",
          active && "cursor-grabbing bg-white/20 text-white"
        )}
        onPointerDown={(e) => {
          capture(e);
          last.current = { x: e.clientX, y: e.clientY };
          setActive(true);
        }}
        onPointerMove={(e) => {
          if (!last.current) return;
          onDrag(e.clientX - last.current.x, e.clientY - last.current.y);
          last.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => {
          last.current = null;
          setActive(false);
        }}
        onPointerCancel={() => {
          last.current = null;
          setActive(false);
        }}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
