"use client";

import { motion } from "framer-motion";
import { ArrowRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InputGroup, InputField } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { Help, Panel, Sections, type SectionDef } from "../panel-kit";
import type { Vectorizer } from "./use-vectorizer";

const fmt = (n: number) => n.toLocaleString();
const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Right panel in Image → SVG mode: what the trace produced, and where it goes next. */
export function ResultPanel({
  v,
  fileName,
  onFileName,
  onDownload,
  onSendToStep,
  style,
}: {
  v: Vectorizer;
  fileName: string;
  onFileName: (name: string) => void;
  onDownload: () => void;
  onSendToStep: () => void;
  style: React.CSSProperties;
}) {
  const d = v.derived;
  const hidden = v.settings.hiddenColors;
  const total = d?.swatches.reduce((sum, s) => sum + s.area, 0) ?? 0;
  const ready = !!d && d.stats.paths > 0;

  const sections: SectionDef[] = [
    {
      id: "summary",
      title: "Summary",
      summary: d ? `${fmt(d.stats.paths)} paths, ${fmt(d.stats.nodes)} nodes` : undefined,
      content: d ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge size="sm" variant="dot" color="gray">
              {fmt(d.stats.paths)} {d.stats.paths === 1 ? "path" : "paths"}
            </Badge>
            <Badge size="sm" variant="dot" color="blue">
              {fmt(d.stats.nodes)} nodes
            </Badge>
            <Badge size="sm" variant="dot" color="emerald">
              {d.stats.colors} {d.stats.colors === 1 ? "colour" : "colours"}
            </Badge>
          </div>
          {v.outcome && (
            <Help>
              Traced in {ms(v.outcome.timings.traceMs)}
              {v.outcome.timings.decodeMs > 5 ? `, decoded in ${ms(v.outcome.timings.decodeMs)}` : ""}.
              {d.stats.nodes > 50_000 && " That's a lot of nodes; fewer colours or more speck removal will simplify it."}
            </Help>
          )}
        </>
      ) : (
        <Help>{v.image ? "Tracing…" : "Open an image to trace it into vector paths."}</Help>
      ),
    },
    {
      id: "colors",
      title: "Colours",
      summary: d ? (hidden.length ? `${hidden.length} hidden` : "All included") : undefined,
      content: d ? (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Colours to include">
            {d.swatches.map((s) => {
              const off = hidden.includes(s.hex);
              const pct = total ? (s.area / total) * 100 : 0;
              return (
                <motion.button
                  key={s.hex}
                  type="button"
                  aria-pressed={!off}
                  title={off ? `Include ${s.hex}` : `Leave out ${s.hex}`}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  onClick={() => v.update({ hiddenColors: toggle(hidden, s.hex) })}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] tabular-nums shadow-surface-1 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                    off ? "bg-transparent text-muted-foreground/60 line-through" : "bg-surface-1 text-foreground hover:bg-hover"
                  )}
                >
                  <span className={cn("size-3 rounded-full ring-1 ring-foreground/20", off && "opacity-40")} style={{ background: s.hex }} />
                  {s.hex.toUpperCase()}
                  <span className="text-muted-foreground">{pct < 1 ? "<1" : Math.round(pct)}%</span>
                </motion.button>
              );
            })}
          </div>
          <Help>Click a colour to leave it out, for example the background before making STEP faces.</Help>
        </>
      ) : (
        <Help>The traced colours appear here.</Help>
      ),
    },
  ];

  const footer = (
    <div className="flex flex-col gap-3">
      <InputGroup>
        <InputField index={0} label="SVG file name" value={fileName} onChange={onFileName} placeholder="traced" />
      </InputGroup>
      <Button variant="primary" leadingIcon={Download} disabled={!ready} onClick={onDownload} className="w-full">
        Download SVG
      </Button>
      <Button variant="secondary" trailingIcon={ArrowRight} disabled={!ready} onClick={onSendToStep} className="w-full">
        Continue to SVG → STEP
      </Button>
      {!v.image && <Help className="text-center">Open an image to get started.</Help>}
    </div>
  );

  return (
    <Panel title="Result" subtitle="Traced vector paths" footer={footer} className="right-4 w-[340px]" style={style}>
      <Sections sections={sections} defaultOpen={["summary", "colors"]} />
    </Panel>
  );
}
