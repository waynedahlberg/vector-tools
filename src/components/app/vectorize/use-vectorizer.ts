"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionsHistory } from "../use-options-history";
import { TraceCanceled, VectorizeClient, type TraceOutcome } from "@/lib/vectorize/client";
import { MAX_FILE_BYTES, MAX_SOURCE_PIXELS, MAX_SOURCE_SIDE } from "@/lib/vectorize/protocol";
import { checkImageFile } from "@/lib/vectorize/image-header";
import {
  DEFAULT_VECTORIZE,
  PER_FILE_VECTORIZE,
  parseVectorizeSettings,
  traceOptions,
  type VectorizeSettings,
} from "@/lib/vectorize/settings";
import { swatches, toSvg, traceStats, visibleLayers } from "@/lib/vectorize/svg";

const SETTINGS_KEY = "svg2step:vectorize";
/** Wait for a pause in slider changes before re-tracing. */
const DEBOUNCE_MS = 180;

export type LoadedImage = { name: string; file: Blob; bytes: number; url: string; key: string };

const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|bmp|avif)$/;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif";

export function isImageFile(f: File) {
  return IMAGE_TYPES.test(f.type) || IMAGE_EXT.test(f.name);
}

/**
 * Checks a picked or dropped file: its type, its size, and the pixel size in its header (so an
 * image too large to decode is refused before it replaces the current one).
 */
export async function readImageFile(f: File): Promise<LoadedImage> {
  if (!isImageFile(f)) throw new Error(`"${f.name}" isn't a supported image. Use PNG, JPEG, WebP, GIF, BMP or AVIF.`);
  if (f.size > MAX_FILE_BYTES) throw new Error(`That image is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const { error } = await checkImageFile(f, { maxPixels: MAX_SOURCE_PIXELS, maxSide: MAX_SOURCE_SIDE });
  if (error) throw new Error(`"${f.name}": ${error}`);
  return {
    name: f.name,
    file: f,
    bytes: f.size,
    url: URL.createObjectURL(f),
    key: `${f.name}:${f.size}:${f.lastModified}:${crypto.randomUUID()}`,
  };
}

export type TraceStatus = "idle" | "tracing" | "done" | "error";

/** Image → SVG state: the open image, settings with undo, and the latest trace. */
export function useVectorizer(active: boolean) {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const history = useOptionsHistory<VectorizeSettings>(
    DEFAULT_VECTORIZE,
    (next) => {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...next, ...PER_FILE_VECTORIZE }));
      } catch {}
    },
    active
  );
  const { value: settings, set, replace } = history;
  const [outcome, setOutcome] = useState<TraceOutcome | null>(null);
  const [status, setStatus] = useState<TraceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const client = useRef<VectorizeClient | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) replace(parseVectorizeSettings(JSON.parse(raw)));
    } catch {}
  }, [replace]);

  useEffect(() => {
    const c = new VectorizeClient();
    client.current = c;
    return () => c.dispose();
  }, []);

  // Only settings the tracer sees trigger a new trace; hiding a colour just filters the result.
  const traceKey = JSON.stringify([traceOptions(settings), settings.resolution, settings.simplify]);
  useEffect(() => {
    if (!image) return;
    const options = traceOptions(settings);
    const { resolution, simplify } = settings;
    let live = true;
    const timer = setTimeout(() => {
      setStatus("tracing");
      setStartedAt(performance.now());
      client.current
        ?.trace({ file: image.file, fileKey: image.key, resolution, options, simplify })
        .then(
          (o) => {
            if (!live) return;
            setOutcome(o);
            setError(null);
            setStatus("done");
          },
          (err: Error) => {
            if (!live || err instanceof TraceCanceled) return;
            setError(err.message);
            setStatus("error");
          }
        );
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- traceKey stands in for the settings
  }, [image, traceKey]);

  const loadImage = useCallback(
    (img: LoadedImage) => {
      setImage((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return img;
      });
      setOutcome(null);
      setError(null);
      setStatus("idle");
      if (settings.hiddenColors.length) set({ ...settings, ...PER_FILE_VECTORIZE });
    },
    [settings, set]
  );

  const closeImage = useCallback(() => {
    client.current?.cancel();
    setImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setOutcome(null);
    setError(null);
    setStatus("idle");
  }, []);

  const derived = useMemo(() => {
    if (!outcome) return null;
    const visible = visibleLayers(outcome.result, settings.hiddenColors);
    return {
      visible,
      stats: traceStats(visible),
      swatches: swatches(outcome.result),
      svg: () =>
        toSvg(outcome.result, {
          hiddenColors: settings.hiddenColors,
          sourceWidth: outcome.source.width,
          sourceHeight: outcome.source.height,
        }),
    };
  }, [outcome, settings.hiddenColors]);

  return {
    image,
    loadImage,
    closeImage,
    history,
    settings,
    update: (patch: Partial<VectorizeSettings>) => set({ ...settings, ...patch }),
    outcome,
    derived,
    status,
    error,
    startedAt,
  };
}

export type Vectorizer = ReturnType<typeof useVectorizer>;
