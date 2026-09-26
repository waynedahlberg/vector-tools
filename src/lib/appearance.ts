"use client";

import { useSyncExternalStore } from "react";

export type Appearance = "system" | "light" | "dark";
export type GlassValues = { alpha: number; blur: number };
export type GlassByAppearance = { light: GlassValues; dark: GlassValues };

export const APPEARANCE_KEY = "svg2step:appearance";
export const GLASS_KEY = "svg2step:glass";

// Dark keeps the settled glass (50% / 10px). Light starts more opaque so a
// white panel stays on top of the elevation ladder instead of mixing down to gray.
export const GLASS_DEFAULTS: GlassByAppearance = {
  light: { alpha: 88, blur: 10 },
  dark: { alpha: 50, blur: 10 },
};

const listeners = new Set<() => void>();
let schemeBound = false;

export function resolveDark(appearance: Appearance, prefersDark: boolean): boolean {
  if (appearance === "dark") return true;
  if (appearance === "light") return false;
  return prefersDark;
}

export function nextAppearance(appearance: Appearance): Appearance {
  if (appearance === "system") return "light";
  if (appearance === "light") return "dark";
  return "system";
}

export function appearanceLabel(appearance: Appearance): string {
  if (appearance === "light") return "Light appearance. Click for dark.";
  if (appearance === "dark") return "Dark appearance. Click to match the system.";
  return "Matching system appearance. Click for light.";
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function glassSlot(value: unknown, fallback: GlassValues): GlassValues {
  if (!value || typeof value !== "object") return fallback;
  const slot = value as { alpha?: unknown; blur?: unknown };
  return {
    alpha: num(slot.alpha, 0, 100, fallback.alpha),
    blur: num(slot.blur, 0, 40, fallback.blur),
  };
}

/** Accept only the per-appearance shape. The old single {alpha, blur} blob is ignored. */
export function parseGlass(raw: string | null): GlassByAppearance {
  if (!raw) return GLASS_DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as { light?: unknown; dark?: unknown } | null;
    if (!parsed || typeof parsed !== "object" || !("light" in parsed) || !("dark" in parsed)) {
      return GLASS_DEFAULTS;
    }
    return {
      light: glassSlot(parsed.light, GLASS_DEFAULTS.light),
      dark: glassSlot(parsed.dark, GLASS_DEFAULTS.dark),
    };
  } catch {
    return GLASS_DEFAULTS;
  }
}

export function readIsDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function getAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(APPEARANCE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {}
  return "system";
}

export function readGlass(): GlassByAppearance {
  try {
    return parseGlass(localStorage.getItem(GLASS_KEY));
  } catch {
    return GLASS_DEFAULTS;
  }
}

export function writeGlass(values: GlassByAppearance) {
  try {
    localStorage.setItem(GLASS_KEY, JSON.stringify(values));
  } catch {}
}

export function applyGlassValues(values: GlassValues) {
  const style = document.documentElement.style;
  style.setProperty("--panel-alpha", String(values.alpha / 100));
  style.setProperty("--panel-blur", `${values.blur}px`);
}

function applyResolvedGlass() {
  applyGlassValues(readGlass()[readIsDark() ? "dark" : "light"]);
}

export function applyAppearance(appearance: Appearance) {
  const dark = resolveDark(appearance, window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.appearance = appearance;
  applyResolvedGlass();
  for (const listener of listeners) listener();
}

export function setAppearance(appearance: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_KEY, appearance);
  } catch {}
  applyAppearance(appearance);
}

function bindScheme() {
  if (schemeBound) return;
  schemeBound = true;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getAppearance() === "system") applyAppearance("system");
  });
}

export function subscribeAppearance(listener: () => void) {
  listeners.add(listener);
  bindScheme();
  return () => listeners.delete(listener);
}

/** Resolved theme. Safe in client-only trees; the server snapshot is "not dark". */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribeAppearance, readIsDark, () => false);
}
