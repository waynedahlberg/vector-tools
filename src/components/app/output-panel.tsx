"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { InputGroup, InputField } from "@/components/ui/input-group";
import type { ConvertOptions, OriginMode, OutputGeometry, Rotation, SizeMode, SizeSource } from "@/lib/convert";
import type { DrawingPlane } from "@/lib/step-writer";
import { formatBytes } from "@/lib/format";
import {
  GAP_STEPS,
  Help,
  HelpList,
  NumberField,
  Panel,
  Reveal,
  SPECK_STEPS,
  Sections,
  StepSlider,
  TOLERANCE_STEPS,
  convertStep,
  type SectionDef,
  type Unit,
} from "./panel-kit";

const OUTPUT_LABEL: Record<OutputGeometry, string> = { curves: "Curves", faces: "Flat faces", both: "Curves + faces" };
const ORIGIN_LABEL: Record<OriginMode, string> = { "bottom-left": "Bottom-left", center: "Center", svg: "SVG coordinates" };
const SIZE_MODES: SizeMode[] = ["scale", "width", "height"];
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

export type ConvertState = {
  result: { step: string; fileName: string } | null;
  converting: boolean;
  canConvert: boolean;
  hint: string | null;
  onConvert: () => void;
  onDownload: () => void;
};

/** Right panel: how the STEP file is written, with the file name and Convert pinned below. */
export function OutputPanel({
  options,
  onChange,
  sizeLabel,
  sizeNote,
  fileName,
  onFileName,
  convert,
  style,
}: {
  options: ConvertOptions;
  onChange: (patch: Partial<ConvertOptions>) => void;
  sizeLabel: string | null;
  sizeNote: string | null;
  fileName: string;
  onFileName: (v: string) => void;
  convert: ConvertState;
  style: React.CSSProperties;
}) {
  const unit = options.unit;
  const withUnit = (v: number) => `${v} ${unit}`;

  const transformSummary =
    [options.rotation ? `${options.rotation}°` : null, options.mirrorX && "mirror H", options.mirrorY && "mirror V"]
      .filter(Boolean)
      .join(", ") || "None";

  const sections: SectionDef[] = [
    {
      id: "output",
      title: "Output",
      summary: OUTPUT_LABEL[options.output],
      help: (
        <HelpList
          items={[
            ["Curves", "Wireframe curves, one per closed or open path. Select them in Plasticity to extrude."],
            ["Flat faces", "Zero-thickness faces with holes already cut out, ready to extrude."],
            ["Curves + faces", "Both in one file."],
          ]}
        />
      ),
      content: (
        <>
          <RadioGroup value={options.output} onValueChange={(v) => onChange({ output: v as OutputGeometry })}>
            <RadioItem index={0} value="curves" label="Curves (wireframe)" />
            <RadioItem index={1} value="faces" label="Flat faces" />
            <RadioItem index={2} value="both" label="Curves + faces" />
          </RadioGroup>
        </>
      ),
    },
    {
      id: "precision",
      title: "Curve precision",
      summary: options.curveMode === "spline" ? "Exact splines" : `Polylines, ${options.tolerance} ${unit}`,
      help: (
        <HelpList
          items={[
            ["Exact splines", "Béziers, lines and arcs become true B-spline curves with no loss of accuracy."],
            ["Polylines", "Curves are flattened into straight segments within the tolerance."],
            ["Exact circles & ellipses", "Keeps circles and ellipses as true STEP circles and ellipses instead of splines."],
          ]}
        />
      ),
      content: (
        <>
          <TabsSubtle
            selectedIndex={options.curveMode === "spline" ? 0 : 1}
            onSelect={(i) => onChange({ curveMode: i === 0 ? "spline" : "polyline" })}
            idPrefix="curve-mode"
          >
            <TabsSubtleItem index={0} label="Exact splines" />
            <TabsSubtleItem index={1} label="Polylines" />
          </TabsSubtle>
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
        </>
      ),
    },
    {
      id: "size",
      title: "Size & units",
      summary: sizeLabel ?? unit,
      help: "Units, and how SVG units become real sizes: from the SVG's document size, pixels at a DPI, or 1 unit = 1 mm, times a scale factor. Or fit the drawing to an exact width or height.",
      content: (
        <>
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
        </>
      ),
    },
    {
      id: "transform",
      title: "Transform",
      summary: transformSummary,
      help: "Rotates counter-clockwise, as seen in CAD, and mirrors the drawing.",
      content: (
        <>
          <TabsSubtle
            selectedIndex={ROTATIONS.indexOf(options.rotation)}
            onSelect={(i) => onChange({ rotation: ROTATIONS[i] })}
            idPrefix="rotation"
          >
            {ROTATIONS.map((r, i) => (
              <TabsSubtleItem key={r} index={i} label={`${r}°`} />
            ))}
          </TabsSubtle>
          <Switch label="Mirror horizontally" checked={options.mirrorX} onToggle={() => onChange({ mirrorX: !options.mirrorX })} />
          <Switch label="Mirror vertically" checked={options.mirrorY} onToggle={() => onChange({ mirrorY: !options.mirrorY })} />
        </>
      ),
    },
    {
      id: "placement",
      title: "Placement",
      summary: `${ORIGIN_LABEL[options.origin]}, ${options.plane.toUpperCase()}`,
      help: "Where the origin sits and which plane the drawing lies on. Elements hidden in the SVG are left out unless included.",
      content: (
        <>
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
        </>
      ),
    },
  ];

  const footer = (
    <div className="flex flex-col gap-3">
      <InputGroup>
        <InputField index={0} label="STEP file name" value={fileName} onChange={onFileName} placeholder="drawing" />
      </InputGroup>
      <AnimatePresence mode="popLayout" initial={false}>
        {convert.result ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2.5 rounded-lg bg-surface-1 px-3 py-2 shadow-surface-1">
              <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#22c55e]/15">
                <Check className="size-3 text-[#16a34a]" strokeWidth={2.5} />
              </div>
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{convert.result.fileName}</span>
              <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                {formatBytes(convert.result.step.length)}
              </span>
            </div>
            <Button variant="primary" leadingIcon={Download} onClick={convert.onDownload} className="w-full">
              Download STEP
            </Button>
          </motion.div>
        ) : (
          <motion.div key="convert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Button
              variant="primary"
              trailingIcon={ArrowRight}
              disabled={!convert.canConvert && !convert.converting}
              loading={convert.converting}
              onClick={convert.onConvert}
              className="w-full"
            >
              Convert to STEP
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      {convert.hint && <Help className="text-center">{convert.hint}</Help>}
    </div>
  );

  return (
    <Panel title="Output" subtitle="How the STEP file is written" footer={footer} className="right-4 w-[340px]" style={style}>
      <Sections sections={sections} defaultOpen={["output", "precision", "size"]} />
    </Panel>
  );
}
