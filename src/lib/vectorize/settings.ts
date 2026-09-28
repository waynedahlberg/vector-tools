// Settings for Image → SVG mode. `TraceOptions` and its string unions are generated from the
// Rust crate (crates/vectorize/src/types.rs), so the UI and the tracer can't drift apart.

import type { ColorMode, CurveFit, Layering, TraceOptions } from "./wasm/vectorize";

export type { ColorMode, CurveFit, Layering, TraceOptions, TraceResult, TraceLayer, Subpath } from "./wasm/vectorize";

/**
 * Size the image is traced at. "auto" enlarges small images to 1024 px (tracing smooths better
 * with more pixels to work from) and reduces large ones to 2048 px (tracing time grows with area).
 */
export type Resolution = "auto" | "1024" | "2048" | "4096" | "original";

export type VectorizeSettings = TraceOptions & {
  resolution: Resolution;
  /** 0–100: refit the traced curves with fewer nodes. 0 keeps the tracer's output as is. */
  simplify: number;
  /** Colours (hex) left out of the output. Chosen per file. */
  hiddenColors: string[];
};

export type PresetId = "logo" | "illustration" | "line-art" | "photo";

/** Mirrors `TraceOptions::default()` in Rust. A test checks they match. */
export const DEFAULT_TRACE: TraceOptions = {
  colorMode: "color",
  paletteSize: 8,
  colorPrecision: 6,
  layerDifference: 16,
  threshold: 128,
  invert: false,
  alphaThreshold: 128,
  denoise: 1,
  filterSpeckle: 4,
  layering: "cutout",
  curveFit: "spline",
  cornerThreshold: 60,
  segmentLength: 4,
  spliceThreshold: 45,
};

export const DEFAULT_VECTORIZE: VectorizeSettings = { ...DEFAULT_TRACE, resolution: "auto", simplify: 40, hiddenColors: [] };

type PresetSettings = Partial<Omit<VectorizeSettings, "resolution" | "hiddenColors">>;

export const PRESETS: Record<PresetId, { label: string; help: string; settings: PresetSettings }> = {
  logo: {
    label: "Logo",
    help: "A few flat colours with crisp corners.",
    settings: { colorMode: "color", paletteSize: 6, denoise: 1, filterSpeckle: 6, curveFit: "spline", cornerThreshold: 60, segmentLength: 4, spliceThreshold: 45, simplify: 50 },
  },
  illustration: {
    label: "Illustration",
    help: "More colours and softer curves.",
    settings: { colorMode: "color", paletteSize: 16, denoise: 1, filterSpeckle: 4, curveFit: "spline", cornerThreshold: 90, segmentLength: 4.5, spliceThreshold: 45, simplify: 40 },
  },
  "line-art": {
    label: "Line art",
    help: "One ink colour from a scan or sketch.",
    settings: { colorMode: "binary", threshold: 128, invert: false, denoise: 1, filterSpeckle: 3, curveFit: "spline", cornerThreshold: 60, segmentLength: 4, spliceThreshold: 45, simplify: 50 },
  },
  photo: {
    label: "Photo",
    help: "Posterised. Expect many paths.",
    settings: { colorMode: "color", paletteSize: 24, denoise: 2, filterSpeckle: 10, curveFit: "spline", cornerThreshold: 180, segmentLength: 5, spliceThreshold: 45, simplify: 30 },
  },
};

/** The preset the settings currently match, if any. */
export function matchPreset(s: VectorizeSettings): PresetId | null {
  for (const [id, p] of Object.entries(PRESETS) as [PresetId, (typeof PRESETS)[PresetId]][]) {
    if ((Object.keys(p.settings) as (keyof PresetSettings)[]).every((k) => s[k] === p.settings[k])) return id;
  }
  return null;
}

/** Settings that only make sense for the file they were chosen on. */
export const PER_FILE_VECTORIZE = { hiddenColors: [] as string[] } satisfies Partial<VectorizeSettings>;

const COLOR_MODES: ColorMode[] = ["color", "binary"];
const LAYERINGS: Layering[] = ["cutout", "stacked"];
const FITS: CurveFit[] = ["spline", "polygon", "pixel"];
const RESOLUTIONS: Resolution[] = ["auto", "1024", "2048", "4096", "original"];

const int = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : fallback;
const oneOf = <T extends string>(v: unknown, all: T[], fallback: T): T => (all.includes(v as T) ? (v as T) : fallback);

/**
 * Coerces anything (saved settings, history entries) into valid settings. Unknown or
 * out-of-range values fall back to defaults. The Rust side clamps again at the boundary.
 */
export function parseVectorizeSettings(raw: unknown): VectorizeSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_VECTORIZE;
  const palette = int(r.paletteSize, 0, 64, d.paletteSize);
  const segment = typeof r.segmentLength === "number" && Number.isFinite(r.segmentLength) ? r.segmentLength : d.segmentLength;
  return {
    colorMode: oneOf(r.colorMode, COLOR_MODES, d.colorMode),
    paletteSize: palette === 1 ? 2 : palette,
    colorPrecision: int(r.colorPrecision, 1, 8, d.colorPrecision),
    layerDifference: int(r.layerDifference, 0, 255, d.layerDifference),
    threshold: int(r.threshold, 0, 255, d.threshold),
    invert: typeof r.invert === "boolean" ? r.invert : d.invert,
    alphaThreshold: int(r.alphaThreshold, 0, 255, d.alphaThreshold),
    denoise: int(r.denoise, 0, 3, d.denoise),
    filterSpeckle: int(r.filterSpeckle, 0, 128, d.filterSpeckle),
    layering: oneOf(r.layering, LAYERINGS, d.layering),
    curveFit: oneOf(r.curveFit, FITS, d.curveFit),
    cornerThreshold: int(r.cornerThreshold, 0, 180, d.cornerThreshold),
    segmentLength: Math.min(10, Math.max(3.5, segment)),
    spliceThreshold: int(r.spliceThreshold, 0, 180, d.spliceThreshold),
    resolution: oneOf(r.resolution, RESOLUTIONS, d.resolution),
    simplify: int(r.simplify, 0, 100, d.simplify),
    hiddenColors: Array.isArray(r.hiddenColors)
      ? r.hiddenColors.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/.test(c))
      : [],
  };
}

/** Just the part the tracer sees. */
export function traceOptions(s: VectorizeSettings): TraceOptions {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { resolution, simplify, hiddenColors, ...trace } = s;
  return trace;
}

/** Long side, in pixels, to trace an image of this size at. Never enlarges more than 4×. */
export function workingSide(resolution: Resolution, width: number, height: number): number {
  const long = Math.max(width, height);
  const target =
    resolution === "original" ? long : resolution === "auto" ? Math.min(Math.max(long, 1024), 2048) : Number(resolution);
  return Math.max(1, Math.round(Math.min(target, long * 4)));
}

/** Width and height to trace at, keeping the aspect ratio. */
export function workingSize(resolution: Resolution, width: number, height: number) {
  const scale = workingSide(resolution, width, height) / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
