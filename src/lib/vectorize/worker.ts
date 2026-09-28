/// <reference lib="webworker" />
// Tracing worker. Decodes the image, keeps the pixels for the next trace of the same file,
// and runs the WebAssembly tracer. Runs off the main thread, so a long trace never blocks the
// page, and the page can end it at any moment with `terminate()`.

import init, { trace } from "./wasm/vectorize";
import { checkImageFile } from "./image-header";
import { MAX_FILE_BYTES, MAX_SOURCE_PIXELS, MAX_SOURCE_SIDE, type Size, type TraceRequest, type TraceResponse } from "./protocol";
import { workingSize, type TraceResult } from "./settings";
import { simplifyTolerance, simplifyTrace } from "./simplify";
import { traceStats } from "./svg";

declare const self: DedicatedWorkerGlobalScope;

let wasm: Promise<WebAssembly.Memory> | null = null;
const ready = () =>
  (wasm ??= init({ module_or_path: new URL("./wasm/vectorize_bg.wasm", import.meta.url) }).then((out) => out.memory));

type Decoded = { key: string; pixels: Uint8Array; width: number; height: number; source: Size };
let decoded: Decoded | null = null;
// The last raw trace, so changing only the simplification skips re-tracing.
let traced: { key: string; result: TraceResult } | null = null;

class UserError extends Error {}

async function decode(file: Blob, key: string, resolution: TraceRequest["resolution"]): Promise<Decoded> {
  if (file.size > MAX_FILE_BYTES) throw new UserError(`That file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  // Checked again here, so the worker never trusts the page to have done it.
  const checked = await checkImageFile(file, { maxPixels: MAX_SOURCE_PIXELS, maxSide: MAX_SOURCE_SIDE });
  if (checked.error !== null) throw new UserError(checked.error);
  const { width: sw, height: sh } = checked.header;

  // Decode straight to the working size, so the full-size bitmap is never held. Only the width
  // is given, so an EXIF rotation can't distort the aspect ratio; the result is checked below.
  const target = workingSize(resolution, sw, sh);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { resizeWidth: target.width, resizeQuality: "high", premultiplyAlpha: "none" });
  } catch {
    throw new UserError("The browser couldn't decode this image.");
  }
  try {
    // Rotated images come out with width and height swapped; fit them to the same long side.
    const long = Math.max(target.width, target.height);
    const scale = Math.min(1, long / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new UserError("This browser can't read image pixels in a worker.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height, { colorSpace: "srgb" }).data;
    const rotated = sw !== sh && sw > sh !== bitmap.width > bitmap.height;
    return {
      key,
      pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      width,
      height,
      source: rotated ? { width: sh, height: sw } : { width: sw, height: sh },
    };
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (e: MessageEvent<TraceRequest>) => {
  const req = e.data;
  if (req?.type !== "trace") return;
  const post = (msg: TraceResponse) => self.postMessage(msg);
  try {
    const memory = await ready();
    const t0 = performance.now();
    const key = `${req.fileKey}|${req.resolution}`;
    if (decoded?.key !== key) {
      decoded = traced = null; // release the previous file's pixels before decoding the next
      decoded = await decode(req.file, key, req.resolution);
    }
    const t1 = performance.now();
    const traceKey = `${key}|${JSON.stringify(req.options)}`;
    if (traced?.key !== traceKey) {
      traced = { key: traceKey, result: trace(decoded.pixels, decoded.width, decoded.height, req.options) };
    }
    const raw = traced.result;
    const upscale = decoded.width / decoded.source.width;
    const result =
      req.simplify > 0 && req.options.curveFit !== "pixel"
        ? simplifyTrace(raw, simplifyTolerance(req.simplify, upscale), req.options.cornerThreshold)
        : raw;
    const t2 = performance.now();
    post({
      type: "result",
      id: req.id,
      result,
      rawNodes: traceStats(raw.layers).nodes,
      source: decoded.source,
      memoryBytes: memory.buffer.byteLength,
      timings: { decodeMs: t1 - t0, traceMs: t2 - t1 },
    });
  } catch (err) {
    // A WebAssembly trap (out of memory, a panic compiled to abort) leaves the instance
    // unusable; errors the tracer returns on purpose arrive as ordinary Errors.
    const fatal = err instanceof WebAssembly.RuntimeError;
    const message =
      err instanceof UserError || (!fatal && err instanceof Error)
        ? err.message
        : "Tracing failed, probably from running out of memory. Try a lower resolution or fewer colours.";
    post({ type: "error", id: req.id, message, fatal });
  }
};
