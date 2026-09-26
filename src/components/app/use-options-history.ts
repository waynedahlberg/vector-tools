"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const LIMIT = 100;
/** Changes to the same settings within this window merge into one undo step (e.g. a slider drag). */
const COALESCE_MS = 700;

type State<T> = { past: T[]; present: T; future: T[] };

function changedKeys<T extends object>(a: T, b: T): string {
  return (Object.keys(b) as (keyof T)[])
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort()
    .join(",");
}

/**
 * Settings with undo/redo. The settings fully describe the output, so this is all "reverting"
 * needs: the source geometry is never modified.
 *
 * `onChange` runs after every committed change (set, undo, redo), from the event handler.
 */
export function useOptionsHistory<T extends object>(initial: T, onChange?: (value: T) => void) {
  const [state, setState] = useState<State<T>>({ past: [], present: initial, future: [] });
  // Handlers read the latest history from here; rendering reads `state`.
  const current = useRef(state);
  const last = useRef<{ at: number; keys: string }>({ at: 0, keys: "" });
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const commit = useCallback((next: State<T>, notify: boolean) => {
    current.current = next;
    setState(next);
    if (notify) onChangeRef.current?.(next.present);
  }, []);

  const set = useCallback(
    (next: T) => {
      const s = current.current;
      const keys = changedKeys(s.present, next);
      if (!keys) return;
      const now = Date.now();
      const merge = keys === last.current.keys && now - last.current.at < COALESCE_MS;
      last.current = { at: now, keys };
      commit({ past: merge ? s.past : [...s.past, s.present].slice(-LIMIT), present: next, future: [] }, true);
    },
    [commit]
  );

  /** Replace the settings without an undo step (e.g. restoring saved preferences on load). */
  const replace = useCallback(
    (next: T) => {
      last.current = { at: 0, keys: "" };
      commit({ past: [], present: next, future: [] }, false);
    },
    [commit]
  );

  const undo = useCallback(() => {
    const s = current.current;
    if (!s.past.length) return;
    last.current = { at: 0, keys: "" };
    commit({ past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] }, true);
  }, [commit]);

  const redo = useCallback(() => {
    const s = current.current;
    if (!s.future.length) return;
    const [present, ...future] = s.future;
    last.current = { at: 0, keys: "" };
    commit({ past: [...s.past, s.present], present, future }, true);
  }, [commit]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y), except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return {
    value: state.present,
    set,
    replace,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
