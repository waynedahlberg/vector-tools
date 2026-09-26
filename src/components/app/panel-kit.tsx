"use client";

// Shared building blocks for the floating panels: the panel shell, collapsible sections, and
// the step slider / number field controls used by several settings.

import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { AccordionContent, AccordionGroup, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Slider } from "@/components/ui/slider";
import { InputGroup, InputField } from "@/components/ui/input-group";
import type { ConvertOptions } from "@/lib/convert";
import { cn } from "@/lib/utils";

export type Unit = ConvertOptions["unit"];

export const TOLERANCE_STEPS = {
  mm: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1],
  in: [0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005],
};
export const GAP_STEPS = {
  mm: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  in: [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.04],
};
export const SPECK_STEPS = {
  mm: [0, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  in: [0, 0.002, 0.005, 0.01, 0.02, 0.04, 0.08, 0.2],
};
export const CORNER_STEPS = [10, 15, 20, 30, 45, 60, 90];

export const fmtLen = (v: number) =>
  v === 0 ? "0" : +v.toPrecision(2) >= 0.01 ? String(+v.toFixed(3)) : v.toPrecision(2);

export function nearestIndex(steps: number[], value: number) {
  return steps.reduce((best, s, i) => (Math.abs(s - value) < Math.abs(steps[best] - value) ? i : best), 0);
}

/** Converts a length setting to the other unit, snapped to that unit's steps. */
export function convertStep(value: number, steps: Record<Unit, number[]>, to: Unit): number {
  const converted = to === "in" ? value / 25.4 : value * 25.4;
  return steps[to][nearestIndex(steps[to], converted)];
}

/**
 * A positive-number field. While typing, the text is kept as a draft and only valid numbers are
 * committed; on blur it shows the current setting again (which may have changed via undo).
 */
export function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(+value.toPrecision(8));
  const n = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(n) && n > 0;
  return (
    <InputGroup>
      <InputField
        index={0}
        label={label}
        inputMode="decimal"
        value={text}
        onChange={(v) => {
          setDraft(v);
          const next = Number(v);
          if (v.trim() !== "" && Number.isFinite(next) && next > 0) onChange(next);
        }}
        onBlur={() => setDraft(null)}
        error={valid ? undefined : "Enter a number above 0"}
      />
    </InputGroup>
  );
}

/** A slider over a fixed list of values, spaced evenly regardless of their magnitude. */
export function StepSlider({
  label,
  steps,
  value,
  onChange,
  format,
}: {
  label: string;
  steps: number[];
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <Slider
      label={label}
      value={nearestIndex(steps, value)}
      onChange={(i) => onChange(steps[i as number])}
      min={0}
      max={steps.length - 1}
      step={1}
      formatValue={(i) => format(steps[i])}
    />
  );
}

/** Animates a block in and out by height, for settings that only apply in some modes. */
export function Reveal({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="overflow-hidden"
        >
          <div className="pt-1">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Help({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[12px] leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

/** A floating panel over the viewport: title, a scrolling body, and an optional pinned footer. */
export function Panel({
  title,
  subtitle,
  footer,
  className,
  style,
  children,
}: {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <aside
      style={style}
      className={cn(
        "pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl panel-glass shadow-surface-6",
        className
      )}
    >
      <header className="flex shrink-0 items-baseline justify-between gap-2 px-4 pb-2 pt-3.5">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {subtitle && <span className="truncate text-[12px] text-muted-foreground">{subtitle}</span>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{children}</div>
      {footer && <footer className="shrink-0 border-t border-border/70 p-4">{footer}</footer>}
    </aside>
  );
}

export type SectionDef = { id: string; title: string; summary?: ReactNode; content: ReactNode };

/** Collapsible sections; collapsed ones show a one-line summary of their current values. */
export function Sections({ sections, defaultOpen }: { sections: SectionDef[]; defaultOpen: string[] }) {
  const [open, setOpen] = useState<string[]>(defaultOpen);
  return (
    <AccordionGroup type="multiple" value={open} onValueChange={setOpen}>
      {sections.map((s, i) => (
        <AccordionItem key={s.id} value={s.id} index={i}>
          <AccordionTrigger>
            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
              <span className="shrink-0">{s.title}</span>
              {s.summary && !open.includes(s.id) && (
                <span className="truncate text-[12px] font-normal text-muted-foreground">{s.summary}</span>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pb-2">{s.content}</div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </AccordionGroup>
  );
}
