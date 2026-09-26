"use client";

// TEMP: live controls for panel translucency and blur, used to pick final values.
// Remove this component (and its use in converter.tsx) once the values are settled; the
// defaults live in globals.css as --panel-alpha and --panel-blur.

import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

const KEY = "svg2step:glass";
const DEFAULTS = { alpha: 95, blur: 12 };

function apply(v: { alpha: number; blur: number }) {
  const root = document.documentElement.style;
  root.setProperty("--panel-alpha", String(v.alpha / 100));
  root.setProperty("--panel-blur", `${v.blur}px`);
}

export function GlassTuner({ top }: { top: number }) {
  const [v, setV] = useState(DEFAULTS);

  useEffect(() => {
    let saved = DEFAULTS;
    try {
      saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    } catch {}
    apply(saved);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from client storage
    setV(saved);
  }, []);

  const update = (patch: Partial<typeof v>) => {
    const next = { ...v, ...patch };
    setV(next);
    apply(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };

  return (
    <div
      className="panel-glass pointer-events-auto absolute left-1/2 flex w-[300px] -translate-x-1/2 flex-col gap-2 rounded-2xl p-3 shadow-surface-6"
      style={{ top }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-foreground">
          Panel glass <span className="font-normal text-muted-foreground">(temporary)</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => update(DEFAULTS)}>
          Reset
        </Button>
      </div>
      <Slider
        label="Opacity"
        value={v.alpha}
        onChange={(n) => update({ alpha: n as number })}
        min={0}
        max={100}
        step={1}
        formatValue={(n) => `${n}%`}
      />
      <Slider
        label="Blur"
        value={v.blur}
        onChange={(n) => update({ blur: n as number })}
        min={0}
        max={40}
        step={1}
        formatValue={(n) => `${n}px`}
      />
    </div>
  );
}
