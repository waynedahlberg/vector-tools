/**
 * Canvas colours for the 3D view.
 *
 * Light mode is a paper ground, a step under the white floating panels, so the
 * panels read as elevated instead of as gray glass over black. Curve colours
 * are deepened so they stay readable on that ground. Dark mode is unchanged.
 */
export type ViewportPalette = {
  background: number;
  gridMinor: number;
  gridMajor: number;
  closed: number;
  open: number;
  face: number;
  vertex: number;
  handle: number;
  openEnd: number;
  selfIntersection: number;
  join: number;
  seam: number;
  ghost: number;
};

const SHARED = {
  selfIntersection: 0xff4d4f,
  join: 0x30d158,
  seam: 0xff6bd6,
};

const DARK: ViewportPalette = {
  ...SHARED,
  background: 0x17191d,
  gridMinor: 0x262a31,
  gridMajor: 0x323741,
  closed: 0x3ee6ff,
  open: 0xffb224,
  face: 0x3ee6ff,
  vertex: 0xf5f7fa,
  handle: 0x8fa3bf,
  openEnd: 0xffb224,
  ghost: 0x6b7280,
};

const LIGHT: ViewportPalette = {
  ...SHARED,
  background: 0xf5f6f8,
  gridMinor: 0xe3e5ea,
  gridMajor: 0xd0d3d9,
  closed: 0x0e7490,
  open: 0xea580c,
  face: 0x0e7490,
  vertex: 0x18181b,
  handle: 0x64748b,
  openEnd: 0xea580c,
  ghost: 0x64748b,
};

/** Hex form of the ground, for SVG that can't read the three.js palette. Keep in sync with globals.css --viewport-bg. */
export const VIEWPORT_BG_HEX = { light: "#f5f6f8", dark: "#17191d" } as const;

export function viewportPalette(dark: boolean): ViewportPalette {
  return dark ? DARK : LIGHT;
}
