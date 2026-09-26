"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Download, FileCode2, Redo2, RefreshCw, RotateCcw, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { Dropzone, SvgFileInput, readSvgFile, type LoadedFile } from "./dropzone";
import { Preview } from "./preview";
import { OptionsPanel } from "./options-panel";
import { HistoryPanel } from "./history-panel";
import { useOptionsHistory } from "./use-options-history";
import { ProblemsList } from "./problems-list";
import dynamic from "next/dynamic";
import { DEFAULT_OPTIONS, GEOMETRY_MODIFIERS, prepare, toStep, type ConvertOptions, type Prepared } from "@/lib/convert";
import { addHistory, clearHistory, deleteHistory, listHistory, type HistoryEntry } from "@/lib/history";
import { downloadText, formatBytes, formatSize } from "@/lib/format";

const OPTIONS_KEY = "svg2step:options";

// three.js only loads once a file is open, and never during prerender.
const Viewport3D = dynamic(() => import("./viewport-3d").then((m) => m.Viewport3D), {
  ssr: false,
  loading: () => <div className="aspect-[16/10] w-full animate-pulse rounded-2xl bg-surface-2 shadow-surface-2" />,
});

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
  const [result, setResult] = useState<Result | null>(null);
  // What the user is typing into the scale field; null shows the current setting.
  const [scaleDraft, setScaleDraft] = useState<string | null>(null);
  const saveOptions = (next: ConvertOptions) => {
    setResult(null);
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {}
  };
  const {
    value: options,
    set: setOptions,
    replace: replaceOptions,
    undo: undoOptions,
    redo: redoOptions,
    canUndo,
    canRedo,
  } = useOptionsHistory<ConvertOptions>(DEFAULT_OPTIONS, (next) => {
    saveOptions(next);
    setScaleDraft(null);
  });
  const [fileName, setFileName] = useState("");
  const [converting, setConverting] = useState(false);
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
    if (saved) replaceOptions(saved);
  }, [replaceOptions]);

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

  const scaleText = scaleDraft ?? String(options.scale);
  const scaleValue = Number(scaleText);
  const scaleError =
    scaleText.trim() === "" || !Number.isFinite(scaleValue) || scaleValue <= 0 ? "Enter a number above 0" : undefined;

  const updateOptions = (patch: Partial<ConvertOptions>) => setOptions({ ...options, ...patch });
  const geometryModified = (Object.keys(GEOMETRY_MODIFIERS) as (keyof typeof GEOMETRY_MODIFIERS)[]).some(
    (k) => JSON.stringify(options[k]) !== JSON.stringify(GEOMETRY_MODIFIERS[k])
  );

  const onScaleText = (v: string) => {
    const n = Number(v);
    if (v.trim() !== "" && Number.isFinite(n) && n > 0) updateOptions({ scale: n });
    setScaleDraft(v);
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
    setOptions({ ...DEFAULT_OPTIONS, ...e.options });
    setScaleDraft(null);
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

              <ProblemsList
                prepared={prepared}
                options={options}
                errors={[prepareError, loadError].filter((e): e is string => !!e)}
                onFix={updateOptions}
              />
            </div>
          )}
          {file && prepared && (
            <Viewport3D prepared={prepared} options={options} fileKey={`${file.name}:${file.svg.length}`} />
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <div className="flex flex-col gap-6 rounded-2xl bg-surface-2 p-5 shadow-surface-2">
            <div className="-mb-2 -mt-1 flex items-center justify-between gap-2">
              <h2 className="text-[14px] font-medium text-foreground">Settings</h2>
              <div className="flex items-center gap-0.5">
                <Tooltip content="Turn off every geometry change (repair, outlines, cleanup, hidden layers)">
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={RotateCcw}
                    disabled={!geometryModified}
                    onClick={() => updateOptions(GEOMETRY_MODIFIERS)}
                  >
                    Reset geometry
                  </Button>
                </Tooltip>
                <Tooltip content="Undo (Ctrl+Z)">
                  <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!canUndo} onClick={undoOptions}>
                    <Undo2 />
                  </Button>
                </Tooltip>
                <Tooltip content="Redo (Ctrl+Shift+Z)">
                  <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!canRedo} onClick={redoOptions}>
                    <Redo2 />
                  </Button>
                </Tooltip>
              </div>
            </div>
            <OptionsPanel
              options={options}
              onChange={updateOptions}
              scaleText={scaleText}
              onScaleText={onScaleText}
              scaleError={scaleError}
              onScaleBlur={() => setScaleDraft(null)}
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
