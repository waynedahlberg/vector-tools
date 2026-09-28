"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Monitor } from "lucide-react";
import { FileInput, SvgFileInput, readSvgFile, type LoadedFile } from "./dropzone";
import { Stage, type View } from "./stage";
import { TopBar, ViewTools3D, type Mode } from "./top-bar";
import { SourcePanel } from "./source-panel";
import { OutputPanel } from "./output-panel";
import { HISTORY_COLLAPSED, HISTORY_EXPANDED, HistoryDock } from "./history-panel";
import { useOptionsHistory } from "./use-options-history";
import type { Insets, ViewportApi } from "./viewport-3d";
import { DEFAULT_OPTIONS, GEOMETRY_MODIFIERS, PER_FILE_OPTIONS, prepare, toStep, type ConvertOptions, type Prepared } from "@/lib/convert";
import { addHistory, clearHistory, deleteHistory, listHistory, type HistoryEntry } from "@/lib/history";
import { downloadText, formatBytes, formatSize } from "@/lib/format";
import { DEFAULT_VECTORIZE } from "@/lib/vectorize/settings";
import { IMAGE_ACCEPT, isImageFile, readImageFile, useVectorizer, type LoadedImage } from "./vectorize/use-vectorizer";
import { TracePanel } from "./vectorize/trace-panel";
import { ResultPanel } from "./vectorize/result-panel";
import { VectorStage, type VectorView } from "./vectorize/vector-stage";

const OPTIONS_KEY = "svg2step:options";
const VIEW_KEY = "svg2step:view";
const NODES_KEY = "svg2step:nodes";
const MODE_KEY = "svg2step:mode";
const VECTOR_VIEW_KEY = "svg2step:vector-view";

const SVG_VIEWS: { id: View; label: string }[] = [
  { id: "3d", label: "3D" },
  { id: "2d", label: "2D" },
  { id: "original", label: "Original" },
];
const VECTOR_VIEWS: { id: VectorView; label: string }[] = [
  { id: "traced", label: "Traced" },
  { id: "outlines", label: "Outlines" },
  { id: "original", label: "Original" },
];

// Layout of the floating chrome, in px. Panels sit below the top bar and above the history dock.
const EDGE = 16;
const TOP_BAR = 48;
const GAP = 12;
const LEFT_W = 320;
const RIGHT_W = 340;

type Result = { step: string; fileName: string; entry: HistoryEntry };

function baseName(name: string) {
  return name.replace(/\.svg$/i, "").trim() || "drawing";
}

function imageBaseName(name: string) {
  return name.replace(/\.[a-z0-9]+$/i, "").trim() || "traced";
}

function safeFileName(name: string) {
  return (name.trim() || "drawing").replace(/[\\/:*?"<>|]+/g, "-").replace(/\.(step|stp)$/i, "");
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function readChoice<T extends string>(key: string, all: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (all.includes(v as T)) return v as T;
  } catch {}
  return fallback;
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

const choiceListeners = new Set<() => void>();
// Choices made this session, so they still apply when storage is blocked (private mode).
const choices = new Map<string, string>();

/**
 * A choice kept in localStorage. The prerendered page uses `fallback` and the stored value
 * takes over on hydration without a mismatch.
 */
function useStoredChoice<T extends string>(key: string, all: readonly T[], fallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    (onChange) => {
      choiceListeners.add(onChange);
      return () => choiceListeners.delete(onChange);
    },
    () => (choices.has(key) ? (choices.get(key) as T) : readChoice(key, all, fallback)),
    () => fallback
  );
  const set = useCallback(
    (v: T) => {
      choices.set(key, v);
      remember(key, v);
      choiceListeners.forEach((l) => l());
    },
    [key]
  );
  return [value, set];
}

export function Converter() {
  return (
    <>
      <div className="fixed inset-0 hidden overflow-hidden lg:block">
        <Workspace />
      </div>
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center lg:hidden">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-2 shadow-surface-3">
          <Monitor className="size-6 text-foreground" strokeWidth={1.75} />
        </div>
        <h1 className="text-[17px] font-semibold text-foreground">This application is best on desktop</h1>
        <p className="max-w-[320px] text-[14px] text-muted-foreground">
          SVG to STEP needs a larger screen for its 3D preview and settings. Open it on a desktop or laptop browser.
        </p>
      </div>
    </>
  );
}

function Workspace() {
  const [mode, chooseMode] = useStoredChoice<Mode>(MODE_KEY, ["svg", "vectorize"], "svg");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
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
  } = useOptionsHistory<ConvertOptions>(DEFAULT_OPTIONS, saveOptions, mode === "svg");
  const vec = useVectorizer(mode === "vectorize");
  const [imageError, setImageError] = useState<string | null>(null);
  const [svgName, setSvgName] = useState("");
  const [vectorView, setVectorView] = useState<VectorView>(() =>
    readChoice(VECTOR_VIEW_KEY, VECTOR_VIEWS.map((v) => v.id), "traced")
  );
  const [fileName, setFileName] = useState("");
  const [converting, setConverting] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<View>(() => readChoice(VIEW_KEY, SVG_VIEWS.map((v) => v.id), "3d"));
  const [showSeams, setShowSeams] = useState(false);
  const [showNodes, setShowNodes] = useState(() => readFlag(NODES_KEY));
  const viewportRef = useRef<ViewportApi | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);


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

  const updateOptions = (patch: Partial<ConvertOptions>) => setOptions({ ...options, ...patch });
  const geometryModified = (Object.keys(GEOMETRY_MODIFIERS) as (keyof typeof GEOMETRY_MODIFIERS)[]).some(
    (k) => JSON.stringify(options[k]) !== JSON.stringify(GEOMETRY_MODIFIERS[k])
  );

  const chooseView = (v: View) => {
    setView(v);
    remember(VIEW_KEY, v);
  };

  const chooseVectorView = (v: VectorView) => {
    setVectorView(v);
    remember(VECTOR_VIEW_KEY, v);
  };

  const loadImage = (img: LoadedImage) => {
    vec.loadImage(img);
    setSvgName(imageBaseName(img.name));
    setImageError(null);
  };

  const downloadSvg = () => {
    const svg = vec.derived?.svg();
    if (svg) downloadText(svg, `${safeFileName(svgName || "traced").replace(/\.svg$/i, "")}.svg`, "image/svg+xml");
  };

  // The trace becomes the SVG → STEP file, as if it had been opened there.
  const sendToStep = () => {
    const svg = vec.derived?.svg();
    if (!svg) return;
    loadFile({ name: `${safeFileName(svgName || "traced").replace(/\.svg$/i, "")}.svg`, svg });
    chooseMode("svg");
  };

  const loadFile = (f: LoadedFile) => {
    // Layer and colour choices belong to the previous file.
    if (options.hiddenLayers.length || options.hiddenColors.length) setOptions({ ...options, ...PER_FILE_OPTIONS });
    setFile(f);
    setFileName(baseName(f.name));
    setLoadError(null);
    setResult(null);
  };

  const closeFile = () => {
    setFile(null);
    setResult(null);
    setLoadError(null);
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
    !!prepared && (options.output === "faces" ? prepared.regions.length > 0 : prepared.shapes.length > 0);
  const canConvert = hasOutput && !converting;

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
    setResult(null);
    setLoadError(null);
  };

  // Files dropped anywhere in the window open, and dragging shows the stage's drop overlay.
  // Without this, a file dropped outside the drop zone would make the browser navigate to it.
  // SVGs open in SVG → STEP and images in Image → SVG, switching mode if needed.
  const openDropped = async (f: File) => {
    const report = mode === "vectorize" ? setImageError : setLoadError;
    try {
      if (isImageFile(f)) {
        loadImage(await readImageFile(f));
        chooseMode("vectorize");
      } else if (/\.svg$/i.test(f.name) || f.type === "image/svg+xml") {
        loadFile(await readSvgFile(f));
        chooseMode("svg");
      } else {
        report(`"${f.name}" isn't an SVG or an image. Open an SVG, PNG, JPEG, WebP, GIF, BMP or AVIF file.`);
      }
    } catch (err) {
      report((err as Error).message);
    }
  };
  const handlers = useRef({ openDropped, mode });
  useEffect(() => {
    handlers.current = { openDropped, mode };
  });
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (e.defaultPrevented) return; // the empty-state drop zone already handled it
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) handlers.current.openDropped(f);
    };
    // Ctrl/Cmd+O opens a file, like a desktop app.
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        (handlers.current.mode === "vectorize" ? imageInputRef : inputRef).current?.click();
      }
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const vectorizing = mode === "vectorize";
  const panelTop = EDGE + TOP_BAR + GAP;
  // Image → SVG has no conversion history, so its panels run to the bottom edge.
  const panelBottom = vectorizing ? EDGE : EDGE + (historyOpen ? HISTORY_EXPANDED : HISTORY_COLLAPSED) + GAP;
  const insets: Insets = useMemo(
    () => ({ top: panelTop, bottom: panelBottom, left: EDGE + LEFT_W + EDGE, right: EDGE + RIGHT_W + EDGE }),
    [panelTop, panelBottom]
  );
  const panelStyle = { top: panelTop, bottom: panelBottom };
  const errors = [prepareError, loadError].filter((e): e is string => !!e);
  const vecModified = JSON.stringify(vec.settings) !== JSON.stringify({ ...DEFAULT_VECTORIZE, hiddenColors: [] });

  const common = {
    mode,
    onMode: chooseMode,
    onOpen: () => (vectorizing ? imageInputRef : inputRef).current?.click(),
  };

  return (
    <>
      <SvgFileInput inputRef={inputRef} onFile={loadFile} onError={setLoadError} />
      <FileInput<LoadedImage>
        inputRef={imageInputRef}
        accept={IMAGE_ACCEPT}
        read={readImageFile}
        onFile={loadImage}
        onError={setImageError}
      />
      {vectorizing ? (
        <>
          <VectorStage v={vec} view={vectorView} insets={insets} dragging={dragging} onImage={loadImage} onError={setImageError} />
          <TopBar
            {...common}
            file={vec.image && { name: vec.image.name, detail: formatBytes(vec.image.bytes) }}
            onClose={vec.closeImage}
            views={VECTOR_VIEWS}
            view={vectorView}
            onView={chooseVectorView}
            canUndo={vec.history.canUndo}
            canRedo={vec.history.canRedo}
            onUndo={vec.history.undo}
            onRedo={vec.history.redo}
            reset={{
              label: "Reset settings",
              tooltip: "Go back to the default trace settings",
              disabled: !vecModified,
              onClick: () => vec.update({ ...DEFAULT_VECTORIZE, hiddenColors: [] }),
            }}
          />
          <TracePanel v={vec} loadError={imageError} style={panelStyle} />
          <ResultPanel
            v={vec}
            fileName={svgName}
            onFileName={setSvgName}
            onDownload={downloadSvg}
            onSendToStep={sendToStep}
            style={panelStyle}
          />
        </>
      ) : (
        <>
          <Stage
            file={file}
            prepared={prepared}
            options={options}
            view={view}
            showSeams={showSeams}
            showNodes={showNodes}
            viewportApi={viewportRef}
            insets={insets}
            dragging={dragging}
            onFile={loadFile}
            onError={setLoadError}
          />
          <TopBar
            {...common}
            file={file && { name: file.name, detail: `${formatBytes(new Blob([file.svg]).size)} SVG` }}
            onClose={closeFile}
            views={SVG_VIEWS}
            view={view}
            onView={chooseView}
            tools={
              view === "3d" && (
                <ViewTools3D
                  showNodes={showNodes}
                  onToggleNodes={() => {
                    setShowNodes(!showNodes);
                    remember(NODES_KEY, String(!showNodes));
                  }}
                  showSeams={showSeams}
                  onToggleSeams={() => setShowSeams((v) => !v)}
                  onCamera={(m) => viewportRef.current?.view(m)}
                />
              )
            }
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undoOptions}
            onRedo={redoOptions}
            reset={{
              label: "Reset geometry",
              tooltip: "Turn off every geometry change (repair, outlines, cleanup, hidden layers)",
              disabled: !geometryModified,
              onClick: () => updateOptions(GEOMETRY_MODIFIERS),
            }}
          />
          <SourcePanel
            options={options}
            onChange={updateOptions}
            prepared={prepared}
            errors={errors}
            hasFile={!!file}
            style={panelStyle}
          />
          <OutputPanel
            options={options}
            onChange={updateOptions}
            sizeLabel={prepared?.bounds ? formatSize(width, height, options.unit) : null}
            sizeNote={prepared?.sizeNote ?? null}
            fileName={fileName}
            onFileName={(v) => {
              setFileName(v);
              setResult(null);
            }}
            convert={{
              result,
              converting,
              canConvert,
              hint: !file
                ? "Open an SVG to get started."
                : prepared && !hasOutput
                  ? options.output === "faces"
                    ? "No closed paths to make faces from."
                    : "No geometry to convert."
                  : null,
              onConvert: convert,
              onDownload: () => result && downloadText(result.step, result.fileName),
            }}
            style={panelStyle}
          />
          <HistoryDock
            entries={history}
            error={historyError}
            open={historyOpen}
            onToggle={() => setHistoryOpen((v) => !v)}
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
        </>
      )}
    </>
  );
}
