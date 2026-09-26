import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_OPTIONS, prepare, toStep, type ConvertOptions } from "@/lib/convert";
import { flatten, signedArea, type Pt, type Shape } from "@/lib/geometry";

export const ROCKET = readFileSync(
  fileURLToPath(new URL("./fixtures/text_on_path_rocket2.svg", import.meta.url)),
  "utf8"
);

export function svg(body: string, attrs = 'width="100mm" height="100mm" viewBox="0 0 100 100"') {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
}

export function run(markup: string, patch: Partial<ConvertOptions> = {}) {
  const options = { ...DEFAULT_OPTIONS, ...patch };
  const prepared = prepare(markup, options);
  return { options, prepared, step: () => toStep(prepared, options, "test") };
}

export const area = (s: Shape) => signedArea(flatten(s, 1e-4));

/** Angle in degrees between the tangent arriving at a closed path's seam and the one leaving it. */
export function seamTurn(s: Shape): number {
  if (s.type !== "path" || !s.closed) return 0;
  const first = s.segments[0];
  const last = s.segments[s.segments.length - 1];
  const out: Pt = first.kind === "line" ? sub(first.p1, first.p0) : sub(first.p1, first.p0);
  const inn: Pt = last.kind === "line" ? sub(last.p1, last.p0) : sub(last.p3, last.p2);
  const a = Math.atan2(out.y, out.x) - Math.atan2(inn.y, inn.x);
  return Math.abs(((a * 180) / Math.PI + 540) % 360 - 180);
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });

/** Parse a STEP file's DATA section into id → entity text. */
export function stepEntities(step: string) {
  const data = step.slice(step.indexOf("DATA;") + 5, step.lastIndexOf("ENDSEC;"));
  const map = new Map<string, string>();
  for (const line of data.split(/;\s*\n/)) {
    const m = /^\s*(#\d+)\s*=\s*([\s\S]+?);?\s*$/.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}
