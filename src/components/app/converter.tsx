"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Download, FileCode2, RefreshCw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { Dropzone, SvgFileInput, readSvgFile, type LoadedFile } from "./dropzone";
import { Preview } from "./preview";
import { OptionsPanel } from "./options-panel";
import { HistoryPanel } from "./history-panel";
import { DEFAULT_OPTIONS, prepare, toStep, type ConvertOptions, type Prepared } from "@/lib/convert";
import { addHistory, clearHistory, deleteHistory, listHistory, type HistoryEntry } from "@/lib/history";
import { downloadText, formatBytes, formatSize } from "@/lib/format";

const OPTIONS_KEY = "svg2step:options";

type Result = { step: string; fileName: string; entry: HistoryEntry };

function baseName(name: string) {
  return name.replace(/\.svg$/i, "").trim() || "drawing";
}

function safeFileName(name: string) {
  return (name.trim() || "drawing").replace(/[\\/:*?"<>|]+/g, "-").replace(/\.(step|stp)$/i, "");
}

export function Converter() {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<ConvertOptions>(DEFAULT_OPTIONS);
  const [scaleText, setScaleText] = useState("1");
  const [fileName, setFileName] = useState("");
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const pageDragDepth = useRef(0);

  // Remember the last-used options in this browser as a convenience. They're read after
  // mount, because the page is prerendered and localStorage only exists on the client.
  useEffect(() => {
    let saved: ConvertOptions | null = null;
    try {
      const raw = localStorage.getItem(OPTIONS_KEY);
      if (raw) saved = { ...DEFAULT_OPTIONS, ...JSON.parse(raw) };
    } catch {}
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from client storage
    setOptions(saved);
    setScaleText(String(saved.scale));
  }, []);

  const commitOptions = (next: ConvertOptions) => {
    setOptions(next);
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {}
  };

  const refreshHistory = useCallback(
    () =>
      listHistory().then(
        (entries) => {
          setHistory(entries);
          setHistoryError(null);
        },
        () => setHistoryError("History isn't available in this browser (private mode may block storage).")
      ),
    []
  );
  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const scaleValue = Number(scaleText);
  const scaleError =
    scaleText.trim() === "" || !Number.isFinite(scaleValue) || scaleValue <= 0 ? "Enter a number above 0" : undefined;

  const updateOptions = (patch: Partial<ConvertOptions>) => {
    commitOptions({ ...options, ...patch });
    setResult(null);
  };

  const onScaleText = (v: string) => {
    setScaleText(v);
    const n = Number(v);
    if (v.trim() !== "" && Number.isFinite(n) && n > 0) updateOptions({ scale: n });
  };

  const loadFile = (f: LoadedFile) => {
    setFile(f);
    setFileName(baseName(f.name));
    setLoadError(null);
    setResult(null);
  };

  const { prepared, prepareError } = useMemo((): { prepared: Prepared | null; prepareError: string | null } => {
    if (!file) return { prepared: null, prepareError: null };
    try {
      return { prepared: prepare(file.svg, options), prepareError: null };
    } catch (err) {
      return { prepared: null, prepareError: (err as Error).message || "Couldn't read this SVG." };
    }
  }, [file, options]);

  const width = prepared?.bounds ? prepared.bounds.maxX - prepared.bounds.minX : 0;
  const height = prepared?.bounds ? prepared.bounds.maxY - prepared.bounds.minY : 0;
  const hasOutput =
    !!prepared &&
    (options.output === "faces" ? prepared.regions.length > 0 : prepared.shapes.length > 0);
  const canConvert = hasOutput && !scaleError && !converting;

  const convert = async () => {
    if (!file || !prepared || !canConvert) return;
    setConverting(true);
    // Let the loading state paint before the synchronous conversion runs.
    await new Promise((r) => setTimeout(r, 60));
    try {
      const name = safeFileName(fileName || baseName(file.name));
      const step = toStep(prepared, options, name);
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        sourceName: file.name,
        stepName: `${name}.step`,
        svg: file.svg,
        step,
        options,
        stats: {
          curves: options.output === "faces" ? 0 : prepared.shapes.length,
          faces: options.output === "curves" ? 0 : prepared.regions.length,
          width,
          height,
        },
      };
      setResult({ step, fileName: entry.stepName, entry });
      try {
        await addHistory(entry);
        await refreshHistory();
      } catch {
        setHistoryError("This conversion couldn't be saved to history, but you can still download it.");
      }
    } catch (err) {
      setLoadError((err as Error).message || "Conversion failed.");
    } finally {
      setConverting(false);
    }
  };

  const restore = (e: HistoryEntry) => {
    setFile({ name: e.sourceName, svg: e.svg });
    setFileName(e.stepName.replace(/\.step$/i, ""));
    commitOptions({ ...DEFAULT_OPTIONS, ...e.options });
    setScaleText(String(e.options.scale));
    setResult(null);
    setLoadError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onPageDrop = async (ev: React.DragEvent) => {
    if (!file) return; // the dropzone handles the empty state
    ev.preventDefault();
    pageDragDepth.current = 0;
    const f = ev.dataTransfer.files?.[0];
    if (!f) return;
    try {
      loadFile(await readSvgFile(f));
    } catch (err) {
      setLoadError((err as Error).message);
    }
  };

  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-16 pt-8 sm:px-6 sm:pt-12"
      onDragOver={(e) => file && e.preventDefault()}
      onDrop={onPageDrop}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
              <FileCode2 className="size-4" strokeWidth={2} />
            </div>
            <h1 className="text-[20px] font-semibold tracking-tight text-foreground">SVG to STEP</h1>
          </div>
          <p className="text-[14px] text-muted-foreground">
            Turn SVG artwork into 2D STEP curves and faces for Plasticity or any CAD tool.
          </p>
        </div>
        <Badge variant="dot" color="green" size="sm" className="self-start sm:self-auto">
          Runs locally in your browser
        </Badge>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {!file ? (
            <Dropzone onFile={loadFile} error={loadError} onError={setLoadError} />
          ) : (
            <div className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-4 shadow-surface-2 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[14px] font-medium text-foreground">{file.name}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {formatBytes(new Blob([file.svg]).size)} SVG · drop another file anywhere to replace
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="secondary" size="sm" leadingIcon={RefreshCw} onClick={() => replaceInputRef.current?.click()}>
                    Replace
                  </Button>
                  <Tooltip content="Close file">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Close file"
                      onClick={() => {
                        setFile(null);
                        setResult(null);
                        setLoadError(null);
                      }}
                    >
                      <X />
                    </Button>
                  </Tooltip>
                  <SvgFileInput inputRef={replaceInputRef} onFile={loadFile} onError={setLoadError} />
                </div>
              </div>

              <Preview svg={file.svg} prepared={prepared} options={options} />

              {prepared && (
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
              )}

              {(prepareError || loadError || (prepared && prepared.warnings.length > 0)) && (
                <ul className="flex flex-col gap-1.5">
                  {[prepareError, loadError, ...(prepared?.warnings ?? [])].filter(Boolean).map((w) => (
                    <motion.li
                      key={w}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-start gap-2 text-[13px] text-muted-foreground"
                    >
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[#f59e0b]" />
                      <span>{w}</span>
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <div className="flex flex-col gap-6 rounded-2xl bg-surface-2 p-5 shadow-surface-2">
            <OptionsPanel
              options={options}
              onChange={updateOptions}
              scaleText={scaleText}
              onScaleText={onScaleText}
              scaleError={scaleError}
              fileName={fileName}
              onFileName={(v) => {
                setFileName(v);
                setResult(null);
              }}
              sizeLabel={prepared?.bounds ? formatSize(width, height, options.unit) : null}
              sizeNote={prepared?.sizeNote ?? null}
            />

            <div className="flex flex-col gap-3 border-t border-border pt-5">
              <AnimatePresence mode="popLayout" initial={false}>
                {result ? (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 28 }}
                    className="flex flex-col gap-3"
                  >
                    <div className="flex items-center gap-2.5 rounded-lg bg-surface-1 px-3 py-2.5 shadow-surface-1">
                      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#22c55e]/15">
                        <Check className="size-3.5 text-[#16a34a]" strokeWidth={2.5} />
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-medium text-foreground">{result.fileName}</span>
                        <span className="text-[12px] tabular-nums text-muted-foreground">
                          {formatBytes(result.step.length)} · saved to history
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      leadingIcon={Download}
                      onClick={() => downloadText(result.step, result.fileName)}
                      className="w-full"
                    >
                      Download STEP
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div key="convert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <Button
                      variant="primary"
                      trailingIcon={ArrowRight}
                      disabled={!canConvert && !converting}
                      loading={converting}
                      onClick={convert}
                      className="w-full"
                    >
                      Convert to STEP
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              {!file && <p className="text-center text-[12px] text-muted-foreground">Load an SVG to get started.</p>}
              {file && prepared && !hasOutput && (
                <p className="text-center text-[12px] text-muted-foreground">
                  {options.output === "faces" ? "No closed paths to make faces from." : "No geometry to convert."}
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {historyError && <p className="text-[13px] text-destructive">{historyError}</p>}
      <HistoryPanel
        entries={history}
        onDownload={(e) => downloadText(e.step, e.stepName)}
        onRestore={restore}
        onDelete={async (e) => {
          await deleteHistory(e.id).catch(() => {});
          refreshHistory();
        }}
        onClear={async () => {
          await clearHistory().catch(() => {});
          refreshHistory();
        }}
      />
    </div>
  );
}
