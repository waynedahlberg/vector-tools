/* tslint:disable */
/* eslint-disable */
/**
 * Everything traced for one colour cluster. Holes are separate subpaths; fill with even-odd.
 */
export interface TraceLayer {
    /**
     * sRGB, 0–255.
     */
    color: [number, number, number];
    /**
     * Pixel area of the cluster.
     */
    area: number;
    subpaths: Subpath[];
}

/**
 * One closed loop. Points are flat `[x0, y0, x1, y1, …]` in image pixels, Y down.
 */
export interface Subpath {
    kind: SubpathKind;
    points: number[];
}

export interface TraceOptions {
    colorMode: ColorMode;
    /**
     * Reduce the image to this many colours (k-means in OKLab) before tracing. 0 = don't.
     */
    paletteSize: number;
    /**
     * 1–8 significant bits per channel when clustering; lower merges more similar colours.
     */
    colorPrecision: number;
    /**
     * 0–255 colour difference between hierarchical layers ("gradient step").
     */
    layerDifference: number;
    /**
     * Binary mode: luminance 0–255 below which a pixel counts as ink.
     */
    threshold: number;
    /**
     * Binary mode: trace the light areas instead of the dark ones.
     */
    invert: boolean;
    /**
     * Pixels with alpha below this (0–255) are transparent and never traced.
     */
    alphaThreshold: number;
    /**
     * Median filter radius in pixels, 0–3. Removes JPEG noise and anti-aliasing fringes.
     */
    denoise: number;
    /**
     * Discard patches smaller than this many pixels across (0–128).
     */
    filterSpeckle: number;
    layering: Layering;
    curveFit: CurveFit;
    /**
     * Degrees, 0–180. Turns sharper than this stay corners.
     */
    cornerThreshold: number;
    /**
     * Pixels, 3.5–10. Shorter segments are merged while fitting.
     */
    segmentLength: number;
    /**
     * Degrees, 0–180. Minimum angle change at which a spline is split.
     */
    spliceThreshold: number;
}

export interface TraceResult {
    width: number;
    height: number;
    /**
     * Bottom to top, in paint order.
     */
    layers: TraceLayer[];
    /**
     * The colours the image was reduced to, if a palette was used.
     */
    palette: [number, number, number][];
    pointCount: number;
}

export type ColorMode = "color" | "binary";

export type CurveFit = "spline" | "polygon" | "pixel";

export type Layering = "cutout" | "stacked";

export type SubpathKind = "cubic" | "polygon";


export function defaultOptions(): TraceOptions;

export function maxPixels(): number;

export function maxSide(): number;

/**
 * Clamps every option to its valid range.
 */
export function sanitizeOptions(options: TraceOptions): TraceOptions;

/**
 * Traces `pixels` (RGBA, row-major, `width * height * 4` bytes) into coloured layers.
 *
 * `Ts<T>` passes plain JS objects through serde, avoiding the leak in tsify's deprecated
 * `into_wasm_abi` path.
 */
export function trace(pixels: Uint8Array, width: number, height: number, options: TraceOptions): TraceResult;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly defaultOptions: () => [number, number, number];
    readonly maxPixels: () => number;
    readonly maxSide: () => number;
    readonly sanitizeOptions: (a: any) => [number, number, number];
    readonly trace: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
