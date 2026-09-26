"use client";

// TEMP: live controls for panel translucency and blur, split by appearance.
// Remove this component (and its use in converter.tsx) once the values are settled; the
// defaults live in globals.css as --panel-alpha and --panel-blur.

import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  applyGlassValues,
  GLASS_DEFAULTS,
  readGlass,
  readIsDark,
  subscribeAppearance,
  writeGlass,
  type GlassValues,
} from "@/lib/appearance";

export function GlassTuner({ top }: { top: number }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [v, setV] = useState<GlassValues>(GLASS_DEFAULTS.light);

  useEffect(() => {
    const sync = () => {
      const next = readIsDark() ? "dark" : "light";
      setTheme(next);
      setV(readGlass()[next]);
    };
    sync();
    return subscribeAppearance(sync);
  }, []);

  const update = (patch: Partial<GlassValues>) => {
    const next = { ...v, ...patch };
    const all = readGlass();
    all[theme] = next;
    setV(next);
    writeGlass(all);
    applyGlassValues(next);
  };

  return (
    <div
      className="panel-glass pointer-events-auto absolute left-1/2 z-10 flex w-[300px] -translate-x-1/2 flex-col gap-2 rounded-2xl p-3 shadow-surface-6"
      style={{ top }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-foreground">
          Panel glass <span className="font-normal text-muted-foreground">(temporary, {theme})</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => update(GLASS_DEFAULTS[theme])}>
          Reset
        </Button>
      </div>
      <Slider
        variant="scrubber"
        label="Opacity"
        value={v.alpha}
        onChange={(n) => update({ alpha: typeof n === "number" ? n : n[0] })}
        min={0}
        max={100}
        step={1}
        formatValue={(n) => `${n}%`}
      />
      <Slider
        variant="scrubber"
        label="Blur"
        value={v.blur}
        onChange={(n) => update({ blur: typeof n === "number" ? n : n[0] })}
        min={0}
        max={40}
        step={1}
        formatValue={(n) => `${n}px`}
      />
    </div>
  );
}
