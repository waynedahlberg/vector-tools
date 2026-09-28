// Conversion history persisted in the browser's IndexedDB, so it survives reloads
// and keeps the STEP output available for re-download without a server.

import type { ConvertOptions } from "./convert";

export type HistoryEntry = {
  id: string;
  createdAt: number;
  sourceName: string;
  stepName: string;
  svg: string;
  step: string;
  options: ConvertOptions;
  stats: { curves: number; faces: number; width: number; height: number };
};

// Keeps the project's original name, so existing history survives the rename to VectorTools.
const DB_NAME = "svg2step";
const STORE = "history";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const all = await tx<HistoryEntry[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const addHistory = (entry: HistoryEntry) => tx("readwrite", (s) => s.put(entry));
export const deleteHistory = (id: string) => tx("readwrite", (s) => s.delete(id));
export const clearHistory = () => tx("readwrite", (s) => s.clear());
