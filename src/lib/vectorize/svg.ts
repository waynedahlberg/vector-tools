// Turns a trace into SVG. The markup is built here from numbers and validated colours, never
// from strings that came out of the tracer, so there's nothing to escape or sanitise.

import type { Subpath, TraceLayer, TraceResult } from "./settings";

export const hex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "0");

export function subpathD(s: Subpath): string {
  const p = s.points;
  if (p.length < 2) return "";
  let d = `M${num(p[0])} ${num(p[1])}`;
  if (s.kind === "cubic") {
    for (let i = 2; i + 5 < p.length; i += 6) {
      d += `C${num(p[i])} ${num(p[i + 1])} ${num(p[i + 2])} ${num(p[i + 3])} ${num(p[i + 4])} ${num(p[i + 5])}`;
    }
  } else {
    for (let i = 2; i + 1 < p.length; i += 2) d += `L${num(p[i])} ${num(p[i + 1])}`;
  }
  return `${d}Z`;
}

export const layerD = (layer: TraceLayer) => layer.subpaths.map(subpathD).join("");

/** Anchor points in a subpath, as a vector editor would count them. */
export function subpathNodes(s: Subpath): number {
  const n = s.points.length / 2;
  return s.kind === "cubic" ? Math.max(0, (n - 1) / 3) : n;
}

export type ColorSwatch = { hex: string; area: number; layers: number };

/** The distinct colours in a trace, largest area first. */
export function swatches(result: TraceResult): ColorSwatch[] {
  const map = new Map<string, ColorSwatch>();
  for (const l of result.layers) {
    const h = hex(l.color);
    const s = map.get(h) ?? { hex: h, area: 0, layers: 0 };
    s.area += l.area;
    s.layers += 1;
    map.set(h, s);
  }
  return [...map.values()].sort((a, b) => b.area - a.area);
}

export type TraceStats = { layers: number; paths: number; nodes: number; colors: number };

export function visibleLayers(result: TraceResult, hiddenColors: string[]): TraceLayer[] {
  if (!hiddenColors.length) return result.layers;
  const hidden = new Set(hiddenColors);
  return result.layers.filter((l) => !hidden.has(hex(l.color)));
}

export function traceStats(layers: TraceLayer[]): TraceStats {
  let paths = 0;
  let nodes = 0;
  const colors = new Set<string>();
  for (const l of layers) {
    colors.add(hex(l.color));
    paths += l.subpaths.length;
    for (const s of l.subpaths) nodes += subpathNodes(s);
  }
  return { layers: layers.length, paths, nodes, colors: colors.size };
}

/**
 * A standalone SVG document. Coordinates are in pixels of the image as it was traced; the
 * document size is the original image's, so the drawing keeps its physical size at 96 DPI.
 */
export function toSvg(
  result: TraceResult,
  { hiddenColors = [], sourceWidth, sourceHeight }: { hiddenColors?: string[]; sourceWidth?: number; sourceHeight?: number } = {}
): string {
  const w = sourceWidth ?? result.width;
  const h = sourceHeight ?? result.height;
  const paths = visibleLayers(result, hiddenColors)
    .map((l) => `  <path fill="${hex(l.color)}" fill-rule="evenodd" d="${layerD(l)}"/>`)
    .join("\n");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${result.width} ${result.height}">`,
    paths,
    `</svg>`,
    "",
  ].join("\n");
}
