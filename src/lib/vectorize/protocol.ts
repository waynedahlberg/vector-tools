// Messages between the page and the tracing worker.

import type { Resolution, TraceOptions, TraceResult } from "./settings";

/** Largest file accepted, in bytes. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Largest image the browser is asked to decode, in pixels (decoded size, not file size). */
export const MAX_SOURCE_PIXELS = 100_000_000;
export const MAX_SOURCE_SIDE = 32_768;

export type TraceRequest = {
  type: "trace";
  id: number;
  /** Blobs are passed by reference; the worker reads and decodes the file itself. */
  file: Blob;
  /** Identifies the file, so the worker can reuse its decoded pixels. */
  fileKey: string;
  resolution: Resolution;
  options: TraceOptions;
  /** 0–100, see `simplifyTolerance`. */
  simplify: number;
};

export type TraceTimings = { decodeMs: number; traceMs: number };
export type Size = { width: number; height: number };

export type TraceResponse =
  | {
      type: "result";
      id: number;
      result: TraceResult;
      /** Nodes before simplification, to show what it saved. */
      rawNodes: number;
      source: Size;
      /** Current size of the worker's WebAssembly memory, which can grow but never shrink. */
      memoryBytes: number;
      timings: TraceTimings;
    }
  | {
      type: "error";
      id: number;
      message: string;
      /** The WebAssembly instance trapped and can't be trusted again; replace the worker. */
      fatal: boolean;
    };
