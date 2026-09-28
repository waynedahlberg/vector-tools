import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { initSync, defaultOptions, sanitizeOptions, trace } from "@/lib/vectorize/wasm/vectorize";
import { readImageHeader } from "@/lib/vectorize/image-header";
import {
  DEFAULT_TRACE,
  DEFAULT_VECTORIZE,
  PRESETS,
  matchPreset,
  parseVectorizeSettings,
  traceOptions,
  workingSize,
} from "@/lib/vectorize/settings";
import { hex, subpathD, swatches, toSvg, traceStats, visibleLayers } from "@/lib/vectorize/svg";
import { simplifyTolerance, simplifyTrace } from "@/lib/vectorize/simplify";
import { DEFAULT_OPTIONS, prepare } from "@/lib/convert";

beforeAll(() => {
  const wasm = readFileSync(fileURLToPath(new URL("../src/lib/vectorize/wasm/vectorize_bg.wasm", import.meta.url)));
  initSync({ module: wasm });
});

/** White background, a black square with a square hole, and a red disc. */
function sample(w = 96, h = 96) {
  const px = new Uint8Array(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inSquare = x >= 8 && x < 40 && y >= 8 && y < 40;
      const inHole = x >= 18 && x < 30 && y >= 18 && y < 30;
      if (inSquare && !inHole) px.set([0, 0, 0], i);
      if ((x - 66) ** 2 + (y - 60) ** 2 < 18 ** 2) px.set([220, 30, 30], i);
    }
  }
  return px;
}

describe("image header", () => {
  const bytes = (...parts: (number[] | string)[]) =>
    new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
  const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const le16 = (n: number) => [n & 255, (n >>> 8) & 255];

  it("reads PNG", () => {
    const png = bytes([0x89], "PNG", [13, 10, 26, 10], be32(13), "IHDR", be32(1200), be32(800));
    expect(readImageHeader(png)).toEqual({ format: "png", width: 1200, height: 800 });
  });
  it("reads GIF", () => {
    expect(readImageHeader(bytes("GIF89a", le16(320), le16(200)))).toEqual({ format: "gif", width: 320, height: 200 });
  });
  it("reads JPEG from the frame header, skipping other segments", () => {
    const app0 = [0xff, 0xe0, 0, 4, 0, 0];
    const sof0 = [0xff, 0xc0, 0, 17, 8, ...le16(0).reverse(), 0x02, 0x58, 0x03, 0x20, 3];
    const jpeg = new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // height 0x0258 = 600, width 0x0320 = 800
    jpeg.set([0x02, 0x58, 0x03, 0x20], 2 + app0.length + 5);
    expect(readImageHeader(jpeg)).toEqual({ format: "jpeg", width: 800, height: 600 });
  });
  it("reads lossless WebP", () => {
    // 1 + 14 bits each: width 400, height 300.
    const w = 399;
    const h = 299;
    const b = [w & 0xff, ((w >> 8) & 0x3f) | ((h & 0x3) << 6), (h >> 2) & 0xff, (h >> 10) & 0x0f];
    const webp = bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8L", [0, 0, 0, 0, 0x2f], b);
    expect(readImageHeader(webp)).toEqual({ format: "webp", width: 400, height: 300 });
  });
  it("rejects anything else", () => {
    expect(readImageHeader(bytes("<svg xmlns"))).toBeNull();
    expect(readImageHeader(new Uint8Array(0))).toBeNull();
  });
});

describe("settings", () => {
  it("match the Rust defaults", () => {
    expect(defaultOptions()).toEqual(DEFAULT_TRACE);
  });
  it("coerce bad input to valid settings", () => {
    const s = parseVectorizeSettings({
      paletteSize: 999,
      colorMode: "rainbow",
      segmentLength: Infinity,
      hiddenColors: ["#ff0000", "red", 3, "#FFF"],
      resolution: "8k",
    });
    expect(s.paletteSize).toBe(64);
    expect(s.colorMode).toBe("color");
    expect(s.segmentLength).toBe(4);
    expect(s.hiddenColors).toEqual(["#ff0000"]);
    expect(s.resolution).toBe("auto");
    expect(parseVectorizeSettings(null)).toEqual(DEFAULT_VECTORIZE);
  });
  it("are clamped again by the tracer", () => {
    const wild = { ...DEFAULT_TRACE, colorPrecision: 99, denoise: 50, segmentLength: 0.1, cornerThreshold: 900 };
    const s = sanitizeOptions(wild);
    expect(s).toMatchObject({ colorPrecision: 8, denoise: 3, segmentLength: 3.5, cornerThreshold: 180 });
  });
  it("recognise presets", () => {
    expect(matchPreset({ ...DEFAULT_VECTORIZE, ...PRESETS.logo.settings })).toBe("logo");
    expect(matchPreset({ ...DEFAULT_VECTORIZE, ...PRESETS.logo.settings, denoise: 3 })).toBeNull();
  });
  it("pick a working size", () => {
    expect(workingSize("auto", 200, 100)).toEqual({ width: 800, height: 400 }); // at most 4× up
    expect(workingSize("auto", 400, 300)).toEqual({ width: 1024, height: 768 });
    expect(workingSize("auto", 6000, 3000)).toEqual({ width: 2048, height: 1024 });
    expect(workingSize("original", 6000, 3000)).toEqual({ width: 6000, height: 3000 });
  });
});

describe("tracing", () => {
  it("rejects pixel data that doesn't match the size", () => {
    expect(() => trace(new Uint8Array(10), 4, 4, DEFAULT_TRACE)).toThrow(/doesn't match/);
    expect(() => trace(new Uint8Array(0), 0, 0, DEFAULT_TRACE)).toThrow(/empty/);
  });

  it("traces colour regions into cutout layers", () => {
    const r = trace(sample(), 96, 96, DEFAULT_TRACE);
    expect(r.width).toBe(96);
    const colors = swatches(r).map((s) => s.hex);
    expect(colors[0]).toBe("#ffffff"); // background has the largest area
    expect(colors.some((c) => c.startsWith("#d") || c.startsWith("#e"))).toBe(true); // the red disc
    const stats = traceStats(r.layers);
    expect(stats.paths).toBeGreaterThanOrEqual(4); // background, square + hole, disc
    for (const l of r.layers) for (const s of l.subpaths) expect(subpathD(s)).toMatch(/^M[\d.]+ [\d.]+(C|L).*Z$/);
  });

  it("traces line art to a single ink layer", () => {
    const r = trace(sample(), 96, 96, traceOptions({ ...DEFAULT_VECTORIZE, ...PRESETS["line-art"].settings }));
    expect(r.layers).toHaveLength(1);
    expect(r.palette).toEqual([]);
  });

  it("simplifies to fewer nodes without moving the shapes", () => {
    const raw = trace(sample(), 96, 96, DEFAULT_TRACE);
    const simple = simplifyTrace(raw, simplifyTolerance(60, 1), DEFAULT_TRACE.cornerThreshold);
    const before = traceStats(raw.layers);
    const after = traceStats(simple.layers);
    expect(after.paths).toBe(before.paths);
    expect(after.nodes).toBeLessThan(before.nodes);
    expect(simple.pointCount).toBe(simple.layers.flatMap((l) => l.subpaths).reduce((n, s) => n + s.points.length / 2, 0));
    for (const l of simple.layers) for (const s of l.subpaths) expect((s.points.length / 2 - 1) % 3).toBe(0);
  });

  it("straightens edges and sharpens corners when simplifying", () => {
    // A 300×200 image enlarged to 1024 px, as "auto" resolution does: soft, bilinear edges.
    const w = 1024;
    const h = 683;
    const k = w / 300;
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x / k;
        const sy = y / k;
        const cov = Math.max(0, Math.min(1, Math.min(sx - 40, 160 - sx, sy - 40, 140 - sy) + 0.5));
        const v = Math.round(255 - cov * 255);
        px.set([v, v, v, 255], (y * w + x) * 4);
      }
    }
    const raw = trace(px, w, h, DEFAULT_TRACE);
    const simple = simplifyTrace(raw, simplifyTolerance(40, k), DEFAULT_TRACE.cornerThreshold);
    const rect = simple.layers.find((l) => l.color[0] < 100)!;
    expect(traceStats([rect]).nodes).toBe(4);
  });

  it("hands off to SVG → STEP as closed faces", () => {
    const settings = { ...DEFAULT_VECTORIZE, hiddenColors: ["#ffffff"] };
    const r = trace(sample(), 96, 96, traceOptions(settings));
    expect(visibleLayers(r, settings.hiddenColors).every((l) => hex(l.color) !== "#ffffff")).toBe(true);
    const svg = toSvg(r, { hiddenColors: settings.hiddenColors, sourceWidth: 96, sourceHeight: 96 });
    expect(svg).not.toContain('fill="#ffffff"');
    const prepared = prepare(svg, { ...DEFAULT_OPTIONS, output: "faces" });
    expect(prepared.openCount).toBe(0);
    expect(prepared.regions.length).toBeGreaterThanOrEqual(2); // the square (with its hole) and the disc
    // 96 px at 96 DPI is 25.4 mm.
    expect(prepared.bounds!.maxX - prepared.bounds!.minX).toBeLessThanOrEqual(25.4);
  });
});
