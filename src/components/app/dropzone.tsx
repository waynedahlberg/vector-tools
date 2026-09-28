"use client";

import { useRef, useState, type DragEvent } from "react";
import { motion } from "framer-motion";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type LoadedFile = { name: string; svg: string };

const MAX_BYTES = 20 * 1024 * 1024;

export async function readSvgFile(file: File): Promise<LoadedFile> {
  const looksSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (!looksSvg) throw new Error(`"${file.name}" isn't an SVG file.`);
  if (file.size > MAX_BYTES) throw new Error("That file is larger than 20 MB.");
  return { name: file.name, svg: await file.text() };
}

const SVG_ACCEPT = ".svg,image/svg+xml";

/** A hidden file picker. `read` checks and loads the chosen file; its errors go to `onError`. */
export function FileInput<T>({
  inputRef,
  accept,
  read,
  onFile,
  onError,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  read: (f: File) => T | Promise<T>;
  onFile: (f: T) => void;
  onError: (msg: string) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      className="sr-only"
      tabIndex={-1}
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        try {
          onFile(await read(file));
        } catch (err) {
          onError((err as Error).message);
        }
      }}
    />
  );
}

export function SvgFileInput(props: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: LoadedFile) => void;
  onError: (msg: string) => void;
}) {
  return <FileInput {...props} accept={SVG_ACCEPT} read={readSvgFile} />;
}

type DropzoneCopy = { title: string; dropping: string; detail: string; ariaLabel: string };

const SVG_COPY: DropzoneCopy = {
  title: "Drop an SVG file here",
  dropping: "Release to load the SVG",
  detail: "Paths, shapes, and groups are converted in your browser. Nothing is uploaded.",
  ariaLabel: "Drop an SVG file here, or press Enter to choose one",
};

/** The empty state: a drop target that fills its container. Defaults to SVG files. */
export function Dropzone<T = LoadedFile>({
  onFile,
  onError,
  accept = SVG_ACCEPT,
  read = readSvgFile as unknown as (f: File) => T | Promise<T>,
  copy = SVG_COPY,
}: {
  onFile: (f: T) => void;
  onError: (msg: string) => void;
  accept?: string;
  read?: (f: File) => T | Promise<T>;
  copy?: DropzoneCopy;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    try {
      onFile(await read(file));
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={copy.ariaLabel}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onClick={() => inputRef.current?.click()}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
      animate={{ scale: dragging ? 0.995 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className={cn(
        "relative flex h-full w-full cursor-pointer flex-col items-center justify-center gap-5 rounded-xl border border-dashed px-6 py-12 text-center outline-none",
        "bg-surface-1 focus-visible:ring-2 focus-visible:ring-focus-ring",
        dragging ? "border-foreground/40 bg-hover" : "border-border hover:border-foreground/25"
      )}
    >
      <motion.div
        animate={{ y: dragging ? -4 : 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className="flex size-14 items-center justify-center rounded-2xl bg-surface-3 shadow-surface-3"
      >
        <FileUp className="size-6 text-foreground" strokeWidth={1.75} />
      </motion.div>
      <div className="flex flex-col gap-1.5">
        <p className="text-[15px] font-medium text-foreground">
          {dragging ? copy.dropping : copy.title}
        </p>
        <p className="text-[13px] text-muted-foreground">{copy.detail}</p>
      </div>
      <Button
        variant="secondary"
        onClick={(e) => {
          e.stopPropagation();
          inputRef.current?.click();
        }}
      >
        Choose file
      </Button>
      <FileInput inputRef={inputRef} accept={accept} read={read} onFile={onFile} onError={onError} />
    </motion.div>
  );
}
