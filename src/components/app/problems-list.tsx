"use client";

import { motion } from "framer-motion";
import { CircleCheck, CircleAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConvertOptions, Prepared } from "@/lib/convert";
import { GAP_STEPS } from "./options-panel";

type Item = {
  key: string;
  tone: "error" | "warning" | "done";
  text: string;
  action?: { label: string; patch: Partial<ConvertOptions> };
};

const TONE = {
  error: { icon: CircleAlert, className: "text-[#e5484d]" },
  warning: { icon: TriangleAlert, className: "text-[#f59e0b]" },
  done: { icon: CircleCheck, className: "text-[#30a46c]" },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Parse warnings, detected geometry problems (with one-click fixes), and what repair changed. */
export function ProblemsList({
  prepared,
  options,
  errors,
  onFix,
}: {
  prepared: Prepared | null;
  options: ConvertOptions;
  errors: string[];
  onFix: (patch: Partial<ConvertOptions>) => void;
}) {
  const items: Item[] = errors.map((e) => ({ key: `err:${e}`, tone: "warning", text: e }));

  if (prepared) {
    const { problems: p, repairs: r } = prepared;
    const u = options.unit;
    if (p.selfIntersectingCurves) {
      items.push({
        key: "self",
        tone: "error",
        text: `${plural(p.selfIntersectingCurves, "curve")} ${p.selfIntersectingCurves === 1 ? "crosses" : "cross"} itself (marked red in the 3D preview). CAD tools may reject ${p.selfIntersectingCurves === 1 ? "it" : "them"}.`,
      });
    }
    if (p.nearGaps) {
      const steps = GAP_STEPS[u];
      const tol = steps.find((s) => s >= p.gapHint) ?? steps[steps.length - 1];
      items.push({
        key: "gaps",
        tone: "warning",
        text: `${plural(p.nearGaps, "gap")} under ${+p.gapHint.toPrecision(2)} ${u} between open ends look unintentional.`,
        action: { label: "Close gaps", patch: { closeGaps: true, gapTolerance: Math.max(tol, options.gapTolerance) } },
      });
    }
    if (p.duplicateCurves) {
      items.push({
        key: "dupes",
        tone: "warning",
        text: `${plural(p.duplicateCurves, "curve")} ${p.duplicateCurves === 1 ? "is an exact copy" : "are exact copies"} of another.`,
        action: { label: "Remove", patch: { removeDuplicates: true } },
      });
    }
    for (const w of prepared.warnings) items.push({ key: `w:${w}`, tone: "warning", text: w });
    if (r.joins.length) items.push({ key: "joined", tone: "done", text: `Closed ${plural(r.joins.length, "gap")} (marked green).` });
    if (r.duplicates) items.push({ key: "removed", tone: "done", text: `Removed ${plural(r.duplicates, "duplicate curve")}.` });
    if (r.specks) items.push({ key: "specks", tone: "done", text: `Removed ${plural(r.specks, "speck")}.` });
  }

  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => {
        const { icon: Icon, className } = TONE[item.tone];
        return (
          <motion.li
            key={item.key}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-start gap-2 text-[13px] text-muted-foreground"
          >
            <Icon className={`mt-0.5 size-3.5 shrink-0 ${className}`} />
            <span className="flex-1">{item.text}</span>
            {item.action && (
              <Button variant="secondary" size="sm" className="-my-1 shrink-0" onClick={() => onFix(item.action!.patch)}>
                {item.action.label}
              </Button>
            )}
          </motion.li>
        );
      })}
    </ul>
  );
}
