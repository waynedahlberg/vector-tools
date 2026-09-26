import type { OutputUnit } from "./step-writer";

export function formatNumber(n: number, unit: OutputUnit) {
  const digits = unit === "in" ? 3 : n >= 100 ? 1 : 2;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatSize(w: number, h: number, unit: OutputUnit) {
  return `${formatNumber(w, unit)} × ${formatNumber(h, unit)} ${unit}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function downloadText(text: string, fileName: string, type = "application/step") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
