"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { InputGroup, InputField } from "@/components/ui/input-group";
import type { ConvertOptions, OriginMode, OutputGeometry, Prepared, Rotation, SizeMode, SizeSource } from "@/lib/convert";
import type { DrawingPlane } from "@/lib/step-writer";
import { SelectionSection } from "./selection-section";

const OUTPUT_HELP: Record<OutputGeometry, string> = {
  curves: "Wireframe curves, one per closed or open path. Select them in Plasticity to extrude.",
  faces: "Flat zero-thickness faces with holes already cut out, ready to extrude.",
  both: "Curves and faces in one file.",
};

type Unit = ConvertOptions["unit"];

const SIZE_MODES: SizeMode[] = ["scale", "width", "height"];
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

const TOLERANCE_STEPS = { mm: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1], in: [0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005] };
export const GAP_STEPS = {
  mm: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  in: [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.04],
};
const SPECK_STEPS = {
  mm: [0, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  in: [0, 0.002, 0.005, 0.01, 0.02, 0.04, 0.08, 0.2],
};

function nearestIndex(steps: number[], value: number) {
  return steps.reduce((best, s, i) => (Math.abs(s - value) < Math.abs(steps[best] - value) ? i : best), 0);
}

/** Converts a length setting to the other unit, snapped to that unit's steps. */
function convertStep(value: number, steps: Record<Unit, number[]>, to: Unit): number {
  const converted = to === "in" ? value / 25.4 : value * 25.4;
  return steps[to][nearestIndex(steps[to], converted)];
}

/**
 * A positive-number field. While typing, the text is kept as a draft and only valid numbers are
 * committed; on blur it shows the current setting again (which may have changed via undo).
 */
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
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
function StepSlider({
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[12px] font-medium uppercase tracking-[0.04em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Reveal({ show, children }: { show: boolean; children: ReactNode }) {
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

export function OptionsPanel({
  options,
  onChange,
  fileName,
  onFileName,
  sizeLabel,
  sizeNote,
  catalog,
}: {
  options: ConvertOptions;
  onChange: (patch: Partial<ConvertOptions>) => void;
  fileName: string;
  onFileName: (v: string) => void;
  sizeLabel: string | null;
  sizeNote: string | null;
  catalog: Pick<Prepared, "layers" | "colors"> | null;
}) {
  const unit = options.unit;
  const withUnit = (v: number) => `${v} ${unit}`;

  return (
    <div className="flex flex-col gap-6">
      <Section title="Output">
        <RadioGroup value={options.output} onValueChange={(v) => onChange({ output: v as OutputGeometry })}>
          <RadioItem index={0} value="curves" label="Curves (wireframe)" />
          <RadioItem index={1} value="faces" label="Flat faces" />
          <RadioItem index={2} value="both" label="Curves + faces" />
        </RadioGroup>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{OUTPUT_HELP[options.output]}</p>
      </Section>

      <Section title="Curve precision">
        <TabsSubtle
          selectedIndex={options.curveMode === "spline" ? 0 : 1}
          onSelect={(i) => onChange({ curveMode: i === 0 ? "spline" : "polyline" })}
          idPrefix="curve-mode"
        >
          <TabsSubtleItem index={0} label="Exact splines" />
          <TabsSubtleItem index={1} label="Polylines" />
        </TabsSubtle>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {options.curveMode === "spline"
            ? "Béziers become true B-spline curves with no loss of accuracy."
            : "Curves are flattened into straight segments within the tolerance."}
        </p>
        <Reveal show={options.curveMode === "polyline"}>
          <StepSlider
            label="Tolerance"
            steps={TOLERANCE_STEPS[unit]}
            value={options.tolerance}
            onChange={(tolerance) => onChange({ tolerance })}
            format={withUnit}
          />
        </Reveal>
        <Reveal show={options.curveMode === "spline"}>
          <Switch
            label="Exact circles & ellipses"
            checked={options.exactEllipses}
            onToggle={() => onChange({ exactEllipses: !options.exactEllipses })}
          />
        </Reveal>
      </Section>

      {catalog && (catalog.layers.length > 1 || catalog.colors.length > 1) && (
        <Section title="Layers & colours">
          <SelectionSection catalog={catalog} options={options} onChange={onChange} />
        </Section>
      )}

      <Section title="Repair">
        <Switch
          label="Close gaps"
          checked={options.closeGaps}
          onToggle={() => onChange({ closeGaps: !options.closeGaps })}
        />
        <Reveal show={options.closeGaps}>
          <StepSlider
            label="Gap tolerance"
            steps={GAP_STEPS[unit]}
            value={options.gapTolerance}
            onChange={(gapTolerance) => onChange({ gapTolerance })}
            format={withUnit}
          />
          <p className="pt-2 text-[12px] leading-relaxed text-muted-foreground">
            Joins open path ends closer than this, and closes paths that nearly meet themselves.
          </p>
        </Reveal>
        <Switch
          label="Remove duplicate curves"
          checked={options.removeDuplicates}
          onToggle={() => onChange({ removeDuplicates: !options.removeDuplicates })}
        />
        <StepSlider
          label="Remove specks under"
          steps={SPECK_STEPS[unit]}
          value={options.minFeatureSize}
          onChange={(minFeatureSize) => onChange({ minFeatureSize })}
          format={(v) => (v === 0 ? "Off" : withUnit(v))}
        />
      </Section>

      <Section title="Size & units">
        <TabsSubtle
          selectedIndex={unit === "mm" ? 0 : 1}
          onSelect={(i) => {
            const next: Unit = i === 0 ? "mm" : "in";
            if (next === unit) return;
            const factor = next === "in" ? 1 / 25.4 : 25.4;
            onChange({
              unit: next,
              tolerance: convertStep(options.tolerance, TOLERANCE_STEPS, next),
              gapTolerance: convertStep(options.gapTolerance, GAP_STEPS, next),
              minFeatureSize: convertStep(options.minFeatureSize, SPECK_STEPS, next),
              targetSize: +(options.targetSize * factor).toPrecision(6),
            });
          }}
          idPrefix="units"
        >
          <TabsSubtleItem index={0} label="Millimetres" />
          <TabsSubtleItem index={1} label="Inches" />
        </TabsSubtle>
        <TabsSubtle
          selectedIndex={SIZE_MODES.indexOf(options.sizeMode)}
          onSelect={(i) => onChange({ sizeMode: SIZE_MODES[i] })}
          idPrefix="size-mode"
        >
          <TabsSubtleItem index={0} label="Scale" />
          <TabsSubtleItem index={1} label="Fit width" />
          <TabsSubtleItem index={2} label="Fit height" />
        </TabsSubtle>
        {options.sizeMode === "scale" ? (
          <>
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-end gap-2">
              <Select value={options.sizeSource} onValueChange={(v) => onChange({ sizeSource: v as SizeSource })}>
                <SelectTrigger aria-label="Size from" className="w-full min-w-0" />
                <SelectContent>
                  <SelectItem index={0} value="document">SVG document size</SelectItem>
                  <SelectItem index={1} value="pixels">Pixels at DPI</SelectItem>
                  <SelectItem index={2} value="unit-mm">1 SVG unit = 1 mm</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={String(options.dpi)}
                onValueChange={(v) => onChange({ dpi: Number(v) })}
                disabled={options.sizeSource === "unit-mm"}
              >
                <SelectTrigger aria-label="DPI" className="w-full min-w-0" />
                <SelectContent>
                  <SelectItem index={0} value="96">96 DPI</SelectItem>
                  <SelectItem index={1} value="72">72 DPI</SelectItem>
                  <SelectItem index={2} value="90">90 DPI</SelectItem>
                  <SelectItem index={3} value="300">300 DPI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumberField label="Scale factor" value={options.scale} onChange={(scale) => onChange({ scale })} />
          </>
        ) : (
          <NumberField
            key={options.sizeMode}
            label={`Target ${options.sizeMode} (${unit})`}
            value={options.targetSize}
            onChange={(targetSize) => onChange({ targetSize })}
          />
        )}
        {sizeLabel && (
          <div className="flex flex-col gap-0.5 rounded-lg bg-surface-1 px-3 py-2 shadow-surface-1">
            <span className="text-[13px] font-medium tabular-nums text-foreground">{sizeLabel}</span>
            {sizeNote && <span className="text-[12px] text-muted-foreground">{sizeNote}</span>}
          </div>
        )}
      </Section>

      <Section title="Transform">
        <TabsSubtle
          selectedIndex={ROTATIONS.indexOf(options.rotation)}
          onSelect={(i) => onChange({ rotation: ROTATIONS[i] })}
          idPrefix="rotation"
        >
          {ROTATIONS.map((r, i) => (
            <TabsSubtleItem key={r} index={i} label={`${r}°`} />
          ))}
        </TabsSubtle>
        <Switch
          label="Mirror horizontally"
          checked={options.mirrorX}
          onToggle={() => onChange({ mirrorX: !options.mirrorX })}
        />
        <Switch
          label="Mirror vertically"
          checked={options.mirrorY}
          onToggle={() => onChange({ mirrorY: !options.mirrorY })}
        />
      </Section>

      <Section title="Placement">
        <Select value={options.origin} onValueChange={(v) => onChange({ origin: v as OriginMode })}>
          <SelectTrigger aria-label="Origin" className="w-full min-w-0" />
          <SelectContent>
            <SelectItem index={0} value="bottom-left">Origin at bottom-left</SelectItem>
            <SelectItem index={1} value="center">Origin at center</SelectItem>
            <SelectItem index={2} value="svg">Keep SVG coordinates</SelectItem>
          </SelectContent>
        </Select>
        <Select value={options.plane} onValueChange={(v) => onChange({ plane: v as DrawingPlane })}>
          <SelectTrigger aria-label="Drawing plane" className="w-full min-w-0" />
          <SelectContent>
            <SelectItem index={0} value="xy">XY plane (top)</SelectItem>
            <SelectItem index={1} value="xz">XZ plane (front)</SelectItem>
            <SelectItem index={2} value="yz">YZ plane (side)</SelectItem>
          </SelectContent>
        </Select>
        <Switch
          label="Include hidden layers"
          checked={options.includeHidden}
          onToggle={() => onChange({ includeHidden: !options.includeHidden })}
        />
      </Section>

      <Section title="File">
        <InputGroup>
          <InputField index={0} label="STEP file name" value={fileName} onChange={onFileName} placeholder="drawing" />
        </InputGroup>
      </Section>
    </div>
  );
}
