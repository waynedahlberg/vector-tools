// Normalises SVG paint values so shapes can be grouped and filtered by colour.

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", lime: "#00ff00",
  blue: "#0000ff", yellow: "#ffff00", cyan: "#00ffff", aqua: "#00ffff", magenta: "#ff00ff",
  fuchsia: "#ff00ff", gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000",
  olive: "#808000", navy: "#000080", purple: "#800080", teal: "#008080", orange: "#ffa500",
  pink: "#ffc0cb", brown: "#a52a2a", gold: "#ffd700", indigo: "#4b0082", violet: "#ee82ee",
  darkgray: "#a9a9a9", darkgrey: "#a9a9a9", lightgray: "#d3d3d3", lightgrey: "#d3d3d3",
};

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

export function normalizePaint(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (!v || v === "inherit") return null;
  if (v === "none" || v === "transparent") return "none";
  if (v in NAMED) return NAMED[v];
  let m = /^#([0-9a-f]{3,4})$/.exec(v);
  if (m) return "#" + [...m[1].slice(0, 3)].map((c) => c + c).join("");
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v);
  if (m) return "#" + m[1];
  m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/.exec(v);
  if (m) {
    const ch = (c: string) => (c.endsWith("%") ? (parseFloat(c) / 100) * 255 : parseFloat(c));
    return "#" + hex2(ch(m[1])) + hex2(ch(m[2])) + hex2(ch(m[3]));
  }
  if (v.startsWith("url(")) return "gradient";
  return v;
}

/** The colour a shape is identified by for filtering: its fill, or its stroke when unfilled. */
export function displayColor(fill: string, stroke: string): string {
  return fill !== "none" ? fill : stroke !== "none" ? stroke : "none";
}
