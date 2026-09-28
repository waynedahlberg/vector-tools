"use client";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  PRESETS,
  matchPreset,
  workingSize,
  type CurveFit,
  type PresetId,
  type Resolution,
  type VectorizeSettings,
} from "@/lib/vectorize/settings";
import { HelpList, Panel, Reveal, Sections, StepSlider, type SectionDef } from "../panel-kit";
import type { Vectorizer } from "./use-vectorizer";

const PRESET_IDS = Object.keys(PRESETS) as PresetId[];
const PALETTE_STEPS = [0, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];
const DENOISE_LABEL = ["Off", "Light", "Medium", "Strong"];
const SPECK_PX = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const FITS: CurveFit[] = ["spline", "polygon", "pixel"];
const RESOLUTION_LABEL: Record<Resolution, string> = {
  auto: "Auto (1024–2048 px)",
  "1024": "1024 px",
  "2048": "2048 px",
  "4096": "4096 px (slow)",
  original: "Original size",
};

/** Left panel in Vectorize mode: how the image is read and traced. */
export function TracePanel({
  v,
  loadError,
  file,
  style,
}: {
  v: Vectorizer;
  loadError: string | null;
  file: { name: string; detail: string; onClose: () => void } | null;
  style: React.CSSProperties;
}) {
  const s = v.settings;
  const on = (patch: Partial<VectorizeSettings>) => v.update(patch);
  const preset = matchPreset(s);
  const color = s.colorMode === "color";
  const src = v.outcome?.source;
  const traced = v.outcome?.result;

  const sections: SectionDef[] = [
    {
      id: "preset",
      title: "Preset",
      summary: preset ? PRESETS[preset].label : "Custom",
      help: (
        <HelpList
          items={[
            ...PRESET_IDS.map((id): [string, string] => [PRESETS[id].label, PRESETS[id].help]),
            ["Custom", "Shown once you change a setting. Pick a preset to start over from it."],
          ]}
        />
      ),
      content: (
        <>
          <TabsSubtle
            selectedIndex={preset ? PRESET_IDS.indexOf(preset) : -1}
            onSelect={(i) => on(PRESETS[PRESET_IDS[i]].settings)}
            idPrefix="trace-preset"
          >
            {PRESET_IDS.map((id, i) => (
              <TabsSubtleItem key={id} index={i} label={PRESETS[id].label} />
            ))}
          </TabsSubtle>
        </>
      ),
    },
    {
      id: "colors",
      title: "Colours",
      summary: color ? (s.paletteSize ? `${s.paletteSize} colours` : "Automatic") : "Black & white",
      help: (
        <HelpList
          items={[
            ["Colours", "Reduces the image to this many colours first (perceptual k-means), which gives cleaner regions. Anti-aliased edges don't use up a colour."],
            ["Auto", "Groups colours by similarity instead. Lower colour precision and a higher gradient step merge more shades."],
            ["Black & white", "Pixels darker than the threshold become one ink colour. Trace light areas to invert."],
          ]}
        />
      ),
      content: (
        <>
          <TabsSubtle
            selectedIndex={color ? 0 : 1}
            onSelect={(i) => on({ colorMode: i === 0 ? "color" : "binary" })}
            idPrefix="trace-color-mode"
          >
            <TabsSubtleItem index={0} label="Colour" />
            <TabsSubtleItem index={1} label="Black & white" />
          </TabsSubtle>
          <Reveal show={color}>
            <div className="flex flex-col gap-3">
              <StepSlider
                label="Colours"
                steps={PALETTE_STEPS}
                value={s.paletteSize}
                onChange={(paletteSize) => on({ paletteSize })}
                format={(n) => (n === 0 ? "Auto" : String(n))}
              />
              <Reveal show={!s.paletteSize}>
                <div className="flex flex-col gap-3">
                  <Slider
                    label="Colour precision"
                    value={s.colorPrecision}
                    onChange={(n) => on({ colorPrecision: n as number })}
                    min={1}
                    max={8}
                    step={1}
                    formatValue={(n) => `${n} bits`}
                  />
                  <Slider
                    label="Gradient step"
                    value={s.layerDifference}
                    onChange={(n) => on({ layerDifference: n as number })}
                    min={0}
                    max={128}
                    step={1}
                    formatValue={(n) => `${n}`}
                  />
                </div>
              </Reveal>
            </div>
          </Reveal>
          <Reveal show={!color}>
            <div className="flex flex-col gap-3">
              <Slider
                label="Threshold"
                value={s.threshold}
                onChange={(n) => on({ threshold: n as number })}
                min={1}
                max={255}
                step={1}
                formatValue={(n) => `${Math.round(((n as number) / 255) * 100)}%`}
              />
              <Switch label="Trace light areas" checked={s.invert} onToggle={() => on({ invert: !s.invert })} />
            </div>
          </Reveal>
        </>
      ),
    },
    {
      id: "cleanup",
      title: "Clean up",
      summary: `Denoise ${DENOISE_LABEL[s.denoise].toLowerCase()}, specks ${s.filterSpeckle ? `< ${s.filterSpeckle} px` : "kept"}`,
      help: (
        <HelpList
          items={[
            ["Denoise", "Smooths JPEG noise and soft edges before tracing."],
            ["Remove specks", "Drops patches smaller than this, measured in traced pixels."],
            ["Transparent below", "Pixels less opaque than this are treated as empty and never traced."],
          ]}
        />
      ),
      content: (
        <>
          <StepSlider
            label="Denoise"
            steps={[0, 1, 2, 3]}
            value={s.denoise}
            onChange={(denoise) => on({ denoise })}
            format={(n) => DENOISE_LABEL[n]}
          />
          <StepSlider
            label="Remove specks under"
            steps={SPECK_PX}
            value={s.filterSpeckle}
            onChange={(filterSpeckle) => on({ filterSpeckle })}
            format={(n) => (n === 0 ? "Off" : `${n} px`)}
          />
          <Slider
            label="Transparent below"
            value={s.alphaThreshold}
            onChange={(n) => on({ alphaThreshold: n as number })}
            min={1}
            max={255}
            step={1}
            formatValue={(n) => `${Math.round(((n as number) / 255) * 100)}% opacity`}
          />
        </>
      ),
    },
    {
      id: "curves",
      title: "Curves",
      summary: `${{ spline: "Smooth", polygon: "Polygon", pixel: "Pixels" }[s.curveFit]}${
        s.curveFit !== "pixel" && s.simplify ? `, simplify ${s.simplify}` : ""
      }`,
      help: (
        <HelpList
          items={[
            ["Smooth", "Bézier curves, the usual choice."],
            ["Polygon", "Straight segments only."],
            ["Pixels", "Follows pixel edges exactly, for pixel art."],
            ["Corners and segments", "Turns sharper than the corner angle stay corners; shorter segments merge while fitting."],
            ["Simplify", "Refits the result with fewer nodes: straight edges become single lines and slightly rounded corners become sharp."],
          ]}
        />
      ),
      content: (
        <>
          <TabsSubtle selectedIndex={FITS.indexOf(s.curveFit)} onSelect={(i) => on({ curveFit: FITS[i] })} idPrefix="trace-fit">
            <TabsSubtleItem index={0} label="Smooth" />
            <TabsSubtleItem index={1} label="Polygon" />
            <TabsSubtleItem index={2} label="Pixels" />
          </TabsSubtle>
          <Reveal show={s.curveFit !== "pixel"}>
            <div className="flex flex-col gap-3">
              <Slider
                label="Keep corners sharper than"
                value={s.cornerThreshold}
                onChange={(n) => on({ cornerThreshold: n as number })}
                min={0}
                max={180}
                step={5}
                formatValue={(n) => `${n}°`}
              />
              <Slider
                label="Segment length"
                value={s.segmentLength}
                onChange={(n) => on({ segmentLength: n as number })}
                min={3.5}
                max={10}
                step={0.5}
                formatValue={(n) => `${n} px`}
              />
            </div>
          </Reveal>
          <Reveal show={s.curveFit !== "pixel"}>
            <div className="flex flex-col gap-3">
              <Slider
                label="Simplify"
                value={s.simplify}
                onChange={(n) => on({ simplify: n as number })}
                min={0}
                max={100}
                step={5}
                formatValue={(n) => (n === 0 ? "Off" : `${n}`)}
              />
              {v.outcome && s.simplify > 0 && (
                <div className="flex flex-col gap-0.5 rounded-lg bg-surface-1 px-3 py-2 shadow-surface-1">
                  <span className="text-[13px] font-medium tabular-nums text-foreground">
                    {v.outcome.rawNodes.toLocaleString()} → {(v.derived?.stats.nodes ?? 0).toLocaleString()} nodes
                  </span>
                </div>
              )}
            </div>
          </Reveal>
          <Reveal show={s.curveFit === "spline"}>
            <Slider
              label="Splice curves over"
              value={s.spliceThreshold}
              onChange={(n) => on({ spliceThreshold: n as number })}
              min={0}
              max={180}
              step={5}
              formatValue={(n) => `${n}°`}
            />
          </Reveal>
        </>
      ),
    },
    {
      id: "layering",
      title: "Layering",
      summary: s.layering === "cutout" ? "Cut out" : "Stacked",
      help: (
        <HelpList
          items={[
            ["Cut out", "Each colour region has the ones above it removed, so shapes never overlap. Best for STEP faces and cutting."],
            ["Stacked", "Shapes sit on top of each other like paper cut-outs. Fewer paths, but they overlap."],
          ]}
        />
      ),
      content: (
        <>
          <RadioGroup value={s.layering} onValueChange={(layering) => on({ layering: layering as VectorizeSettings["layering"] })}>
            <RadioItem index={0} value="cutout" label="Cut out (no overlaps)" />
            <RadioItem index={1} value="stacked" label="Stacked" />
          </RadioGroup>
        </>
      ),
    },
    {
      id: "resolution",
      title: "Resolution",
      summary: traced ? `${traced.width} × ${traced.height} px` : RESOLUTION_LABEL[s.resolution],
      help: "The size the image is traced at. Small images are enlarged first, which gives smoother curves; larger sizes trace more slowly.",
      content: (
        <>
          <Select value={s.resolution} onValueChange={(r) => on({ resolution: r as Resolution })}>
            <SelectTrigger aria-label="Trace resolution" className="w-full min-w-0" />
            <SelectContent>
              {(Object.keys(RESOLUTION_LABEL) as Resolution[]).map((r, i) => (
                <SelectItem key={r} index={i} value={r}>
                  {RESOLUTION_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {src && (
            <div className="flex flex-col gap-0.5 rounded-lg bg-surface-1 px-3 py-2 shadow-surface-1">
              <span className="text-[13px] font-medium tabular-nums text-foreground">
                {(() => {
                  const w = workingSize(s.resolution, src.width, src.height);
                  return `Traced at ${w.width} × ${w.height} px`;
                })()}
              </span>
              <span className="text-[12px] tabular-nums text-muted-foreground">
                Original {src.width} × {src.height} px
              </span>
            </div>
          )}
        </>
      ),
    },
  ];

  return (
    <Panel title="Trace" subtitle="How the image is read" file={file} className="left-4 w-[320px]" style={style}>
      {[loadError, v.error].filter(Boolean).map((msg) => (
        <p key={msg} role="alert" className="mx-2 mb-2 rounded-lg bg-[#ef4444]/10 px-3 py-2 text-[12px] leading-relaxed text-[#dc2626]">
          {msg}
        </p>
      ))}
      <Sections sections={sections} defaultOpen={["preset", "colors", "cleanup", "curves"]} />
    </Panel>
  );
}
