// Parses SVG markup into transformed geometry in root user units.
// Uses only basic DOM APIs so it runs in the browser (DOMParser) and in Node tests.

import { IDENTITY, multiply, transformShape, type Mat, type Pt, type Segment, type Shape, type ShapeMeta } from "./geometry";
import { normalizePaint } from "./paint";

export type SvgDocumentInfo = {
  /** Root width/height in millimetres when the SVG declares absolute units, else null. */
  widthMm: number | null;
  heightMm: number | null;
  viewBox: [number, number, number, number] | null;
  widthAttr: string | null;
  heightAttr: string | null;
};

export type SvgLayer = { id: string; name: string };

/** Layer key for shapes that aren't inside a top-level group. */
export const UNGROUPED = "~ungrouped";

export type ParsedSvg = {
  shapes: Shape[];
  info: SvgDocumentInfo;
  warnings: string[];
  /** Top-level groups that contain geometry, in document order. */
  layers: SvgLayer[];
};

export type ParseOptions = {
  includeHidden: boolean;
  exactEllipses: boolean;
};

const SKIPPED = new Set([
  "defs", "clipPath", "mask", "symbol", "marker", "pattern", "metadata", "title", "desc",
  "style", "script", "linearGradient", "radialGradient", "filter", "foreignObject",
  "sodipodi:namedview", "namedview",
]);

const ABS_UNITS: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25 };

function parseLength(v: string | null): { value: number; unit: string } | null {
  if (!v) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(v);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: m[2].toLowerCase() };
}

function toMm(v: string | null): number | null {
  const l = parseLength(v);
  if (!l || !(l.unit in ABS_UNITS)) return null;
  return l.value * ABS_UNITS[l.unit];
}

function num(el: Element, name: string, fallback = 0): number {
  const l = parseLength(el.getAttribute(name));
  return l ? l.value : fallback;
}

function styleValue(el: Element, prop: string): string | null {
  const direct = el.getAttribute(prop);
  if (direct) return direct.trim();
  const style = el.getAttribute("style");
  if (!style) return null;
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(style);
  return m ? m[1].trim() : null;
}

function elementChildren(el: Element): Element[] {
  return Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);
}

function localName(el: Element): string {
  return el.localName || el.nodeName.replace(/^.*:/, "");
}

// ---------------------------------------------------------------------------
// transform="" parsing
// ---------------------------------------------------------------------------

export function parseTransform(v: string | null): Mat {
  if (!v) return IDENTITY;
  let m: Mat = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(v))) {
    const a = (match[2].match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) || []).map(Number);
    let t: Mat = IDENTITY;
    switch (match[1]) {
      case "matrix":
        if (a.length === 6) t = a as Mat;
        break;
      case "translate":
        t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
        break;
      case "scale":
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const r = ((a[0] || 0) * Math.PI) / 180;
        const c = Math.cos(r), s = Math.sin(r);
        const cx = a[1] || 0, cy = a[2] || 0;
        t = multiply(multiply([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, t);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Path data parsing
// ---------------------------------------------------------------------------

type PathCursor = { d: string; i: number };

function skipSep(c: PathCursor) {
  while (c.i < c.d.length && /[\s,]/.test(c.d[c.i])) c.i++;
}

function readNumber(c: PathCursor): number | null {
  skipSep(c);
  const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(c.d.slice(c.i, c.i + 64));
  if (!m) return null;
  c.i += m[0].length;
  return parseFloat(m[0]);
}

function readFlag(c: PathCursor): number | null {
  skipSep(c);
  const ch = c.d[c.i];
  if (ch === "0" || ch === "1") {
    c.i++;
    return ch === "1" ? 1 : 0;
  }
  return null;
}

/** Convert an SVG elliptical arc into cubic Béziers, each spanning at most 45°. */
function arcToCubics(
  p0: Pt, rxIn: number, ryIn: number, phiDeg: number, largeArc: number, sweep: number, p1: Pt
): Segment[] {
  if (p0.x === p1.x && p0.y === p1.y) return [];
  let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ kind: "line", p0, p1 }];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1) / ry, cyp = (-coef * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2;
  const cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dTheta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const n = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 4) - 1e-9));
  const delta = dTheta / n;
  const k = (4 / 3) * Math.tan(delta / 4);
  const pointAt = (t: number): Pt => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  });
  const derivAt = (t: number): Pt => ({
    x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  });
  const segs: Segment[] = [];
  let start = p0;
  for (let i = 0; i < n; i++) {
    const t0 = theta1 + i * delta, t1 = t0 + delta;
    const end = i === n - 1 ? p1 : pointAt(t1);
    const d0 = derivAt(t0), d1 = derivAt(t1);
    segs.push({
      kind: "cubic",
      p0: start,
      p1: { x: start.x + k * d0.x, y: start.y + k * d0.y },
      p2: { x: end.x - k * d1.x, y: end.y - k * d1.y },
      p3: end,
    });
    start = end;
  }
  return segs;
}

type RawSubpath = { segments: Segment[]; closed: boolean };

export function parsePathData(d: string): RawSubpath[] {
  const out: RawSubpath[] = [];
  const c: PathCursor = { d, i: 0 };
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let sub: RawSubpath | null = null;
  let lastCmd = "";
  let lastCtrl: Pt | null = null; // reflected control point for S/T
  let lastQuad: Pt | null = null;

  const push = (seg: Segment) => {
    if (!sub) {
      sub = { segments: [], closed: false };
      out.push(sub);
    }
    sub.segments.push(seg);
  };

  while (true) {
    skipSep(c);
    if (c.i >= d.length) break;
    let cmd = d[c.i];
    if (/[a-zA-Z]/.test(cmd)) {
      c.i++;
    } else if (lastCmd && lastCmd.toLowerCase() !== "z") {
      // Implicit repeat; a repeated moveto becomes a lineto.
      cmd = lastCmd === "M" ? "L" : lastCmd === "m" ? "l" : lastCmd;
    } else {
      break; // malformed
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cur.x : 0, oy = rel ? cur.y : 0;
    const U = cmd.toUpperCase();
    let ok = true;

    const pt = (): Pt | null => {
      const x = readNumber(c), y = readNumber(c);
      return x === null || y === null ? null : { x: x + ox, y: y + oy };
    };

    switch (U) {
      case "M": {
        const p = pt();
        if (!p) { ok = false; break; }
        cur = p;
        start = p;
        sub = null;
        lastCtrl = lastQuad = null;
        break;
      }
      case "L": {
        const p = pt();
        if (!p) { ok = false; break; }
        push({ kind: "line", p0: cur, p1: p });
        cur = p;
        lastCtrl = lastQuad = null;
        break;
      }
      case "H": {
        const x = readNumber(c);
        if (x === null) { ok = false; break; }
        const p = { x: x + ox, y: cur.y };
        push({ kind: "line", p0: cur, p1: p });
        cur = p;
        lastCtrl = lastQuad = null;
        break;
      }
      case "V": {
        const y = readNumber(c);
        if (y === null) { ok = false; break; }
        const p = { x: cur.x, y: y + oy };
        push({ kind: "line", p0: cur, p1: p });
        cur = p;
        lastCtrl = lastQuad = null;
        break;
      }
      case "C": {
        const p1 = pt(), p2 = pt(), p3 = pt();
        if (!p1 || !p2 || !p3) { ok = false; break; }
        push({ kind: "cubic", p0: cur, p1, p2, p3 });
        cur = p3;
        lastCtrl = p2;
        lastQuad = null;
        break;
      }
      case "S": {
        const p2 = pt(), p3 = pt();
        if (!p2 || !p3) { ok = false; break; }
        const p1 = lastCtrl ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
        push({ kind: "cubic", p0: cur, p1, p2, p3 });
        cur = p3;
        lastCtrl = p2;
        lastQuad = null;
        break;
      }
      case "Q":
      case "T": {
        let q: Pt | null;
        if (U === "Q") q = pt();
        else q = lastQuad ? { x: 2 * cur.x - lastQuad.x, y: 2 * cur.y - lastQuad.y } : cur;
        const p = pt();
        if (!q || !p) { ok = false; break; }
        push({
          kind: "cubic",
          p0: cur,
          p1: { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) },
          p2: { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
          p3: p,
        });
        cur = p;
        lastQuad = q;
        lastCtrl = null;
        break;
      }
      case "A": {
        const rx = readNumber(c), ry = readNumber(c), rot = readNumber(c);
        const large = readFlag(c), sweep = readFlag(c);
        const p = pt();
        if (rx === null || ry === null || rot === null || large === null || sweep === null || !p) {
          ok = false;
          break;
        }
        arcToCubics(cur, rx, ry, rot, large, sweep, p).forEach(push);
        cur = p;
        lastCtrl = lastQuad = null;
        break;
      }
      case "Z": {
        if (sub) {
          const s = sub as RawSubpath;
          s.closed = true;
        }
        cur = start;
        sub = null;
        lastCtrl = lastQuad = null;
        break;
      }
      default:
        ok = false;
    }
    if (!ok) break;
    lastCmd = cmd;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Element → shapes
// ---------------------------------------------------------------------------

function rectPath(x: number, y: number, w: number, h: number, rxIn: number, ryIn: number): string {
  let rx = rxIn, ry = ryIn;
  if (rx <= 0 && ry > 0) rx = ry;
  if (ry <= 0 && rx > 0) ry = rx;
  rx = Math.min(Math.max(rx, 0), w / 2);
  ry = Math.min(Math.max(ry, 0), h / 2);
  if (rx === 0 || ry === 0) return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
  return (
    `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}` +
    `V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}` +
    `H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}` +
    `V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`
  );
}

function pointsPath(pointsAttr: string | null, close: boolean): string | null {
  const n = (pointsAttr?.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) || []).map(Number);
  if (n.length < 4) return null;
  let d = `M${n[0]},${n[1]}`;
  for (let i = 2; i + 1 < n.length; i += 2) d += `L${n[i]},${n[i + 1]}`;
  return close ? d + "Z" : d;
}

function cleanSubpath(raw: RawSubpath): RawSubpath | null {
  const EPS = 1e-9;
  const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
  const segs = raw.segments.filter((s) =>
    s.kind === "line" ? !same(s.p0, s.p1) : !(same(s.p0, s.p1) && same(s.p1, s.p2) && same(s.p2, s.p3))
  );
  if (!segs.length) return null;
  const first = segs[0].p0;
  const lastSeg = segs[segs.length - 1];
  const last = lastSeg.kind === "line" ? lastSeg.p1 : lastSeg.p3;
  let closed = raw.closed;
  if (closed && !same(first, last)) segs.push({ kind: "line", p0: last, p1: first });
  // Paths that end where they start count as closed even without a Z.
  if (!closed && segs.length > 1 && same(first, last)) closed = true;
  return { segments: segs, closed };
}

export function parseSvg(doc: Document, opts: ParseOptions): ParsedSvg {
  const warnings: string[] = [];
  const root = doc.documentElement;
  if (!root || localName(root) !== "svg" || doc.getElementsByTagName("parsererror").length) {
    throw new Error("This file isn't valid SVG markup.");
  }

  const vbNums = (root.getAttribute("viewBox") || "").split(/[\s,]+/).filter(Boolean).map(Number);
  const viewBox =
    vbNums.length === 4 && vbNums.every(Number.isFinite) && vbNums[2] > 0 && vbNums[3] > 0
      ? (vbNums as [number, number, number, number])
      : null;
  const info: SvgDocumentInfo = {
    widthMm: toMm(root.getAttribute("width")),
    heightMm: toMm(root.getAttribute("height")),
    viewBox,
    widthAttr: root.getAttribute("width"),
    heightAttr: root.getAttribute("height"),
  };

  const byId = new Map<string, Element>();
  const indexIds = (el: Element) => {
    const id = el.getAttribute("id");
    if (id) byId.set(id, el);
    for (const child of elementChildren(el)) indexIds(child);
  };
  indexIds(root);

  const shapes: Shape[] = [];
  const layers: SvgLayer[] = [];
  let skippedText = 0, skippedImages = 0, strokeOnly = 0, clipped = 0, unnamed = 0, groups = 0;
  const GEOMETRY = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);

  type Ctx = {
    key: string;
    layer: string;
    fill: string;
    stroke: string;
    strokeWidth: number;
    linecap: ShapeMeta["linecap"];
    linejoin: ShapeMeta["linejoin"];
    miterLimit: number;
  };

  const metaFor = (ctx: Ctx, sub: number): ShapeMeta => ({
    id: `${ctx.key}:${sub}`,
    layer: ctx.layer,
    fill: ctx.fill,
    stroke: ctx.stroke,
    strokeWidth: ctx.stroke === "none" ? 0 : ctx.strokeWidth,
    linecap: ctx.linecap,
    linejoin: ctx.linejoin,
    miterLimit: ctx.miterLimit,
  });

  const addPath = (d: string, name: string, m: Mat, ctx: Ctx) => {
    const subpaths = parsePathData(d)
      .map(cleanSubpath)
      .filter((c): c is RawSubpath => c !== null);
    subpaths.forEach((clean, i) => {
      const label = i > 0 ? `${name}.${i + 1}` : name;
      shapes.push(transformShape({ type: "path", name: label, meta: metaFor(ctx, i), ...clean }, m));
    });
  };

  const walk = (el: Element, parent: Mat, depth: number, inherited: Ctx) => {
    if (depth > 64) return;
    const tag = localName(el);
    if (SKIPPED.has(tag) || el.nodeName.includes("sodipodi")) return;
    if (!opts.includeHidden) {
      if (styleValue(el, "display") === "none") return;
      const vis = styleValue(el, "visibility");
      if (vis === "hidden" || vis === "collapse") return;
    }
    let m = multiply(parent, parseTransform(el.getAttribute("transform")));
    const name = el.getAttribute("id") || `${tag}_${++unnamed}`;
    const width = parseLength(styleValue(el, "stroke-width"));
    const cap = styleValue(el, "stroke-linecap");
    const join = styleValue(el, "stroke-linejoin");
    const miter = parseFloat(styleValue(el, "stroke-miterlimit") ?? "");
    const ctx: Ctx = {
      ...inherited,
      fill: normalizePaint(styleValue(el, "fill")) ?? inherited.fill,
      stroke: normalizePaint(styleValue(el, "stroke")) ?? inherited.stroke,
      strokeWidth: width && width.unit !== "%" ? width.value : inherited.strokeWidth,
      linecap: cap === "round" || cap === "square" || cap === "butt" ? cap : inherited.linecap,
      linejoin: join === "round" || join === "bevel" || join === "miter" ? join : inherited.linejoin,
      miterLimit: Number.isFinite(miter) && miter >= 1 ? miter : inherited.miterLimit,
    };
    if (
      el.getAttribute("clip-path") ||
      el.getAttribute("mask") ||
      /(?:^|;)\s*(?:clip-path|mask)\s*:/.test(el.getAttribute("style") || "")
    ) {
      clipped++;
    }
    // Lines and polylines are usually drawn as strokes, so only flag filled-shape types.
    if (GEOMETRY.has(tag) && tag !== "line" && tag !== "polyline" && ctx.fill === "none" && ctx.stroke !== "none") {
      strokeOnly++;
    }

    const walkChildren = (parentEl: Element, mat: Mat, scope: Ctx) => {
      elementChildren(parentEl).forEach((child, i) => {
        const id = child.getAttribute("id");
        const childCtx: Ctx = { ...scope, key: `${scope.key}/${id ? `#${id}` : `${localName(child)}[${i}]`}` };
        // Top-level groups are treated as layers (Inkscape and Illustrator export layers this way).
        if (parentEl === root) {
          if (localName(child) === "g") {
            const label = child.getAttribute("inkscape:label") || child.getAttribute("data-name") || id;
            layers.push({ id: childCtx.key, name: label || `Group ${++groups}` });
            childCtx.layer = childCtx.key;
          } else {
            childCtx.layer = UNGROUPED;
          }
        }
        walk(child, mat, depth + 1, childCtx);
      });
    };

    switch (tag) {
      case "svg":
        if (el !== root) m = multiply(m, [1, 0, 0, 1, num(el, "x"), num(el, "y")]);
        walkChildren(el, m, ctx);
        return;
      case "g":
      case "a":
      case "switch":
        walkChildren(el, m, ctx);
        return;
      case "use": {
        const href = el.getAttribute("href") || el.getAttribute("xlink:href") || "";
        const target = href.startsWith("#") ? byId.get(href.slice(1)) : undefined;
        if (!target) return;
        const mm = multiply(m, [1, 0, 0, 1, num(el, "x"), num(el, "y")]);
        const useCtx: Ctx = { ...ctx, key: `${ctx.key}>#${href.slice(1)}` };
        if (localName(target) === "symbol") walkChildren(target, mm, useCtx);
        else walk(target, mm, depth + 1, useCtx);
        return;
      }
      case "path":
        addPath(el.getAttribute("d") || "", name, m, ctx);
        return;
      case "rect": {
        const w = num(el, "width"), h = num(el, "height");
        if (w > 0 && h > 0) {
          addPath(rectPath(num(el, "x"), num(el, "y"), w, h, num(el, "rx", -1), num(el, "ry", -1)), name, m, ctx);
        }
        return;
      }
      case "circle":
      case "ellipse": {
        const cx = num(el, "cx"), cy = num(el, "cy");
        const rx = tag === "circle" ? num(el, "r") : num(el, "rx", -1);
        const ry = tag === "circle" ? num(el, "r") : num(el, "ry", -1);
        const rxF = rx > 0 ? rx : ry, ryF = ry > 0 ? ry : rx;
        if (!(rxF > 0 && ryF > 0)) return;
        if (opts.exactEllipses) {
          shapes.push(
            transformShape(
              {
                type: "ellipse",
                name,
                meta: metaFor(ctx, 0),
                center: { x: cx, y: cy },
                axis: { x: 1, y: 0 },
                rx: rxF,
                ry: ryF,
              },
              m
            )
          );
        } else {
          addPath(
            `M${cx + rxF},${cy}A${rxF},${ryF} 0 0 1 ${cx - rxF},${cy}A${rxF},${ryF} 0 0 1 ${cx + rxF},${cy}Z`,
            name,
            m,
            ctx
          );
        }
        return;
      }
      case "line":
        addPath(`M${num(el, "x1")},${num(el, "y1")}L${num(el, "x2")},${num(el, "y2")}`, name, m, ctx);
        return;
      case "polyline":
      case "polygon": {
        const d = pointsPath(el.getAttribute("points"), tag === "polygon");
        if (d) addPath(d, name, m, ctx);
        return;
      }
      case "text":
        skippedText++;
        return;
      case "image":
        skippedImages++;
        return;
      default:
        walkChildren(el, m, ctx);
    }
  };

  walk(root, IDENTITY, 0, {
    key: "svg",
    layer: UNGROUPED,
    fill: "#000000",
    stroke: "none",
    strokeWidth: 1,
    linecap: "butt",
    linejoin: "miter",
    miterLimit: 4,
  });

  if (skippedText) {
    warnings.push(
      `Skipped ${skippedText} text element${skippedText > 1 ? "s" : ""}. Convert text to outlines/paths in your editor first.`
    );
  }
  if (strokeOnly) {
    warnings.push(
      `${strokeOnly} shape${strokeOnly > 1 ? "s are" : " is"} stroke-only and will convert as a centerline. Turn on "Outline strokes" to export the visible stroke width.`
    );
  }
  if (clipped) {
    warnings.push(
      `${clipped} element${clipped > 1 ? "s use" : " uses"} a clip path or mask. Clipping is ignored, so the full unclipped geometry is exported.`
    );
  }
  if (skippedImages) {
    warnings.push(
      `Skipped ${skippedImages} embedded raster image${skippedImages > 1 ? "s" : ""}. Only vector geometry converts.`
    );
  }
  if (!shapes.length) warnings.push("No vector geometry was found in this SVG.");

  const usedLayers = new Set(shapes.map((s) => s.meta.layer));
  const outLayers = layers.filter((l) => usedLayers.has(l.id));
  if (usedLayers.has(UNGROUPED)) outLayers.push({ id: UNGROUPED, name: "Ungrouped" });
  return { shapes, info, warnings, layers: outLayers };
}
