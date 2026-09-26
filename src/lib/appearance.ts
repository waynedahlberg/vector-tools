"use client";

import { useSyncExternalStore } from "react";

export type Appearance = "system" | "light" | "dark";

export const APPEARANCE_KEY = "svg2step:appearance";

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

export function applyAppearance(appearance: Appearance) {
  const dark = resolveDark(appearance, window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.appearance = appearance;
  // Drop any inline overrides left by the temporary glass tuner.
  document.documentElement.style.removeProperty("--panel-alpha");
  document.documentElement.style.removeProperty("--panel-blur");
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
  return () => {
    listeners.delete(listener);
  };
}

/** Resolved theme. Safe in client-only trees; the server snapshot is "not dark". */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribeAppearance, readIsDark, () => false);
}
