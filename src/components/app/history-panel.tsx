"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronUp, Download, History, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { HistoryEntry } from "@/lib/history";
import { formatBytes, formatSize } from "@/lib/format";

const OUTPUT_LABEL = { curves: "Curves", faces: "Faces", both: "Curves + faces" } as const;
const OUTPUT_COLOR = { curves: "blue", faces: "emerald", both: "violet" } as const;

/** Heights of the dock, so the layout can keep panels and the viewport clear of it. */
export const HISTORY_COLLAPSED = 48;
export const HISTORY_EXPANDED = 264;

function when(ts: number) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Conversion history, docked along the bottom edge. Collapses to a one-line bar. */
export function HistoryDock({
  entries,
  error,
  open,
  onToggle,
  onDownload,
  onRestore,
  onDelete,
  onClear,
}: {
  entries: HistoryEntry[];
  error: string | null;
  open: boolean;
  onToggle: () => void;
  onDownload: (e: HistoryEntry) => void;
  onRestore: (e: HistoryEntry) => void;
  onDelete: (e: HistoryEntry) => void;
  onClear: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const latest = entries[0];

  return (
    <motion.section
      initial={false}
      animate={{ height: open ? HISTORY_EXPANDED : HISTORY_COLLAPSED }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="pointer-events-auto absolute inset-x-4 bottom-4 flex flex-col overflow-hidden rounded-2xl panel-glass shadow-surface-6"
      aria-label="Conversion history"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 pl-2 pr-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <History className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-[13px] font-semibold text-foreground">History</span>
          <span className="text-[12px] tabular-nums text-muted-foreground">{entries.length}</span>
          {!open && latest && (
            <span className="min-w-0 truncate text-[12px] text-muted-foreground">
              · Latest: {latest.stepName}, {when(latest.createdAt)}
            </span>
          )}
          {error && <span className="min-w-0 truncate text-[12px] text-destructive">· {error}</span>}
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="ml-auto flex shrink-0"
          >
            <ChevronUp className="size-4 text-muted-foreground" />
          </motion.span>
        </button>
        {!open && latest && (
          <Tooltip content={`Download ${latest.stepName}`}>
            <Button variant="ghost" size="icon-sm" aria-label="Download latest STEP" onClick={() => onDownload(latest)}>
              <Download />
            </Button>
          </Tooltip>
        )}
        {open && entries.length > 0 && (
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                Clear history
              </Button>
            </DialogTrigger>
            <DialogContent size="sm">
              <DialogHeader>
                <DialogTitle>Clear conversion history?</DialogTitle>
                <DialogDescription>
                  This removes all {entries.length} saved conversions and their STEP files from this browser. It can&apos;t
                  be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button
                  variant="primary"
                  onClick={() => {
                    onClear();
                    setConfirmOpen(false);
                  }}
                >
                  Clear history
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" hidden={!open}>
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-[13px] text-muted-foreground">
            Conversions you run are saved here in this browser, so you can download them again later.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Output</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>STEP</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e, i) => (
                <TableRow key={e.id} index={i}>
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium text-foreground">{e.stepName}</span>
                      <span className="truncate text-[12px] text-muted-foreground">from {e.sourceName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge size="sm" variant="dot" color={OUTPUT_COLOR[e.options.output]}>
                      {OUTPUT_LABEL[e.options.output]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums text-muted-foreground">
                    {formatSize(e.stats.width, e.stats.height, e.options.unit)}
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums text-muted-foreground">{formatBytes(e.step.length)}</TableCell>
                  <TableCell className="text-[13px] tabular-nums text-muted-foreground">{when(e.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5">
                      <Tooltip content="Download STEP">
                        <Button variant="ghost" size="icon-sm" aria-label="Download STEP" onClick={() => onDownload(e)}>
                          <Download />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Load SVG and settings">
                        <Button variant="ghost" size="icon-sm" aria-label="Load SVG and settings" onClick={() => onRestore(e)}>
                          <RotateCcw />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Remove from history">
                        <Button variant="ghost" size="icon-sm" aria-label="Remove from history" onClick={() => onDelete(e)}>
                          <Trash2 />
                        </Button>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </motion.section>
  );
}
