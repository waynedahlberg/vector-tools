"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, RotateCcw, Trash2 } from "lucide-react";
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

function when(ts: number) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function HistoryPanel({
  entries,
  onDownload,
  onRestore,
  onDelete,
  onClear,
}: {
  entries: HistoryEntry[];
  onDownload: (e: HistoryEntry) => void;
  onRestore: (e: HistoryEntry) => void;
  onDelete: (e: HistoryEntry) => void;
  onClear: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[15px] font-medium text-foreground">History</h2>
          <span className="text-[13px] tabular-nums text-muted-foreground">{entries.length}</span>
        </div>
        {entries.length > 0 && (
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
                  This removes all {entries.length} saved conversions and their STEP files from this browser. It
                  can&apos;t be undone.
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

      {entries.length === 0 ? (
        <div className="rounded-xl bg-surface-1 px-4 py-8 text-center text-[13px] text-muted-foreground shadow-surface-1">
          Conversions you run are saved here in this browser, so you can download them again later.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-surface-2 p-1 shadow-surface-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="hidden md:table-cell">Output</TableHead>
                <TableHead className="hidden sm:table-cell">Size</TableHead>
                <TableHead className="hidden lg:table-cell">STEP</TableHead>
                <TableHead className="hidden sm:table-cell">When</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
                {entries.map((e, i) => (
                  <TableRow key={e.id} index={i}>
                    <TableCell>
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 28 }}
                        className="flex min-w-0 flex-col"
                      >
                        <span className="truncate text-[13px] font-medium text-foreground">{e.stepName}</span>
                        <span className="truncate text-[12px] text-muted-foreground">from {e.sourceName}</span>
                      </motion.div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge size="sm" variant="dot" color={OUTPUT_COLOR[e.options.output]}>
                        {OUTPUT_LABEL[e.options.output]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-[13px] tabular-nums text-muted-foreground sm:table-cell">
                      {formatSize(e.stats.width, e.stats.height, e.options.unit)}
                    </TableCell>
                    <TableCell className="hidden text-[13px] tabular-nums text-muted-foreground lg:table-cell">
                      {formatBytes(e.step.length)}
                    </TableCell>
                    <TableCell className="hidden text-[13px] tabular-nums text-muted-foreground sm:table-cell">
                      {when(e.createdAt)}
                    </TableCell>
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
        </div>
      )}
    </section>
  );
}
