"use client";

import { motion } from "framer-motion";
import { CheckboxGroup, CheckboxItem } from "@/components/ui/checkbox-group";
import type { ConvertOptions, Prepared } from "@/lib/convert";
import { cn } from "@/lib/utils";

const colorLabel = (c: string) => (c === "none" ? "No paint" : c === "gradient" ? "Gradient" : c.toUpperCase());

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Layer checkboxes and colour swatches that choose which parts of the SVG are exported. */
export function SelectionSection({
  catalog,
  options,
  onChange,
}: {
  catalog: Pick<Prepared, "layers" | "colors">;
  options: ConvertOptions;
  onChange: (patch: Partial<ConvertOptions>) => void;
}) {
  const { layers, colors } = catalog;
  const visible = new Set(layers.map((l, i) => (options.hiddenLayers.includes(l.id) ? -1 : i)).filter((i) => i >= 0));

  return (
    <div className="flex flex-col gap-3">
      {layers.length > 1 && (
        <CheckboxGroup checkedIndices={visible}>
          {layers.map((l, i) => (
            <CheckboxItem
              key={l.id}
              index={i}
              label={`${l.name} (${l.count})`}
              checked={visible.has(i)}
              onToggle={() => onChange({ hiddenLayers: toggle(options.hiddenLayers, l.id) })}
            />
          ))}
        </CheckboxGroup>
      )}
      {colors.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Colours to export">
          {colors.map(({ color, count }) => {
            const hidden = options.hiddenColors.includes(color);
            return (
              <motion.button
                key={color}
                type="button"
                aria-pressed={!hidden}
                title={hidden ? `Include ${colorLabel(color)}` : `Leave out ${colorLabel(color)}`}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                onClick={() => onChange({ hiddenColors: toggle(options.hiddenColors, color) })}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] tabular-nums shadow-surface-1 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                  hidden ? "bg-transparent text-muted-foreground/60 line-through" : "bg-surface-1 text-foreground hover:bg-hover"
                )}
              >
                <span
                  className={cn("size-3 rounded-full ring-1 ring-foreground/20", hidden && "opacity-40")}
                  style={{
                    background: color.startsWith("#")
                      ? color
                      : "repeating-linear-gradient(45deg, var(--muted-foreground) 0 2px, transparent 2px 4px)",
                  }}
                />
                {colorLabel(color)}
                <span className="text-muted-foreground">{count}</span>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
