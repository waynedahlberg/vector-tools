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

export function SvgFileInput({
  inputRef,
  onFile,
  onError,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: LoadedFile) => void;
  onError: (msg: string) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".svg,image/svg+xml"
      className="sr-only"
      tabIndex={-1}
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        try {
          onFile(await readSvgFile(file));
        } catch (err) {
          onError((err as Error).message);
        }
      }}
    />
  );
}

export function Dropzone({
  onFile,
  error,
  onError,
}: {
  onFile: (f: LoadedFile) => void;
  error: string | null;
  onError: (msg: string) => void;
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
      onFile(await readSvgFile(file));
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <motion.div
        role="button"
        tabIndex={0}
        aria-label="Drop an SVG file here, or press Enter to choose one"
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
        animate={{ scale: dragging ? 1.01 : 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className={cn(
          "relative flex min-h-[380px] cursor-pointer flex-col items-center justify-center gap-5 rounded-2xl border border-dashed px-6 py-12 text-center outline-none",
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
            {dragging ? "Release to load the SVG" : "Drop an SVG file here"}
          </p>
          <p className="text-[13px] text-muted-foreground">
            Paths, shapes, and groups are converted in your browser. Nothing is uploaded.
          </p>
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
        <SvgFileInput inputRef={inputRef} onFile={onFile} onError={onError} />
      </motion.div>
      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="px-1 text-[13px] text-destructive"
          role="alert"
        >
          {error}
        </motion.p>
      )}
    </div>
  );
}
