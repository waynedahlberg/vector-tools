"use client";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import type { ConvertOptions, Prepared } from "@/lib/convert";
import {
  CORNER_STEPS,
  GAP_STEPS,
  Help,
  HelpList,
  Panel,
  Reveal,
  SPECK_STEPS,
  Sections,
  StepSlider,
  fmtLen,
  type SectionDef,
} from "./panel-kit";
import { ProblemsList } from "./problems-list";
import { SelectionSection } from "./selection-section";

/** Left panel: what's read from the SVG, checks on it, and changes to its geometry. */
export function SourcePanel({
  options,
  onChange,
  prepared,
  errors,
  hasFile,
  file,
  style,
}: {
  options: ConvertOptions;
  onChange: (patch: Partial<ConvertOptions>) => void;
  prepared: Prepared | null;
  errors: string[];
  hasFile: boolean;
  file: { name: string; detail: string; onClose: () => void } | null;
  style: React.CSSProperties;
}) {
  const unit = options.unit;
  const withUnit = (v: number) => `${v} ${unit}`;
  const strokeOnly = prepared?.strokeOnly ?? 0;
  const showSelection = !!prepared && (prepared.layers.length > 1 || prepared.colors.length > 1);
  const issues =
    (prepared?.problems.selfIntersectingCurves ?? 0) +
    (prepared?.problems.nearGaps ?? 0) +
    (prepared?.problems.duplicateCurves ?? 0) +
    (prepared?.warnings.length ?? 0) +
    errors.length;

  const repairOn = [
    options.closeGaps && "gaps",
    options.removeDuplicates && "duplicates",
    options.minFeatureSize > 0 && "specks",
  ].filter(Boolean);
  const shapeOn = [options.outlineStrokes && "outlines", options.cleanup && `cleanup ${options.cleanupStrength}`].filter(
    Boolean
  );

  const sections: SectionDef[] = [
    {
      id: "checks",
      title: "Checks",
      summary: issues ? `${issues} to review` : hasFile ? "All clear" : undefined,
      help: "What the SVG contains, and anything worth fixing before export: self-intersecting curves, open ends that nearly meet, duplicates and stroke-only shapes. Most have a one-click fix.",
      content: (
        <>
          {prepared ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge size="sm" variant="dot" color="gray">
                {prepared.shapes.length} {prepared.shapes.length === 1 ? "path" : "paths"}
              </Badge>
              <Badge size="sm" variant="dot" color="blue">
                {prepared.closedCount} closed
              </Badge>
              {prepared.openCount > 0 && (
                <Badge size="sm" variant="dot" color="orange">
                  {prepared.openCount} open
                </Badge>
              )}
              {options.output !== "curves" && (
                <Badge size="sm" variant="dot" color="emerald">
                  {prepared.regions.length} {prepared.regions.length === 1 ? "face" : "faces"}
                </Badge>
              )}
            </div>
          ) : (
            !errors.length && <Help>Open an SVG to check it.</Help>
          )}
          <ProblemsList prepared={prepared} options={options} errors={errors} onFix={onChange} />
          {prepared && !issues && <Help>No problems found.</Help>}
        </>
      ),
    },
    ...(showSelection
      ? [
          {
            id: "selection",
            title: "Layers & colours",
            summary:
              options.hiddenLayers.length || options.hiddenColors.length
                ? `${options.hiddenLayers.length + options.hiddenColors.length} hidden`
                : "All included",
            help: "Top-level groups (Inkscape or Illustrator layers) and fill or stroke colours. Untick a layer or click a colour to leave it out of the STEP file.",
            content: <SelectionSection catalog={prepared!} options={options} onChange={onChange} />,
          },
        ]
      : []),
    {
      id: "repair",
      title: "Repair",
      summary: repairOn.length ? repairOn.join(", ") : "Off",
      help: (
        <HelpList
          items={[
            ["Close gaps", "Joins open path ends closer than the tolerance, and closes paths that nearly meet themselves."],
            ["Remove duplicate curves", "Drops exact copies, whatever their direction or start point."],
            ["Remove specks", "Drops shapes smaller than the size."],
          ]}
        />
      ),
      content: (
        <>
          <Switch label="Close gaps" checked={options.closeGaps} onToggle={() => onChange({ closeGaps: !options.closeGaps })} />
          <Reveal show={options.closeGaps}>
            <StepSlider
              label="Gap tolerance"
              steps={GAP_STEPS[unit]}
              value={options.gapTolerance}
              onChange={(gapTolerance) => onChange({ gapTolerance })}
              format={withUnit}
            />
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
        </>
      ),
    },
    {
      id: "shape",
      title: "Shape",
      summary: shapeOn.length ? shapeOn.join(", ") : "Off",
      help: (
        <HelpList
          items={[
            ["Outline strokes", "Turns stroke-only shapes into closed outlines at their visible width, respecting caps and joins."],
            [
              "Curve cleanup",
              "Refits curves with fewer nodes within a tolerance set by the strength. Straight lines, corners and exact circles are kept. The original shows as a ghost in the 3D view; turn this off to go back to it exactly.",
            ],
          ]}
        />
      ),
      content: (
        <>
          <Switch
            label={hasFile ? `Outline strokes (${strokeOnly})` : "Outline strokes"}
            checked={options.outlineStrokes}
            onToggle={() => onChange({ outlineStrokes: !options.outlineStrokes })}
          />
          <Switch label="Curve cleanup" checked={options.cleanup} onToggle={() => onChange({ cleanup: !options.cleanup })} />
          <Reveal show={options.cleanup}>
            <div className="flex flex-col gap-3">
              <Slider
                label="Strength"
                value={options.cleanupStrength}
                onChange={(v) => onChange({ cleanupStrength: v as number })}
                min={0}
                max={100}
                step={5}
                formatValue={(v) => `${v}`}
              />
              <StepSlider
                label="Keep corners sharper than"
                steps={CORNER_STEPS}
                value={options.cornerAngle}
                onChange={(cornerAngle) => onChange({ cornerAngle })}
                format={(v) => `${v}°`}
              />
              {prepared?.cleanup && (
                <div className="flex flex-col gap-0.5 rounded-lg bg-surface-1 px-3 py-2 shadow-surface-1">
                  <span className="text-[13px] font-medium tabular-nums text-foreground">
                    {prepared.cleanup.nodesBefore} → {prepared.cleanup.nodesAfter} nodes
                  </span>
                  <span className="text-[12px] tabular-nums text-muted-foreground">
                    Max deviation {fmtLen(prepared.cleanup.maxDeviation)} {unit} (limit {fmtLen(prepared.cleanup.tolerance)}{" "}
                    {unit})
                  </span>
                </div>
              )}
            </div>
          </Reveal>
        </>
      ),
    },
  ];

  return (
    <Panel title="Source" subtitle="What's read from your SVG" file={file} className="left-4 w-[320px]" style={style}>
      <Sections sections={sections} defaultOpen={["checks", "selection", "repair", "shape"]} />
    </Panel>
  );
}
