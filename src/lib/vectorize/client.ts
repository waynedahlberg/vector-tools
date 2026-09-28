// Runs traces in a dedicated worker and owns its lifecycle.
//
// A WebAssembly trace can't be interrupted, and WebAssembly memory can grow but never shrink.
// So the worker is disposable: a newer request, a timeout or a trap terminates it (which is
// instant and frees all its memory), and it's replaced after a trace leaves its memory large.

import type { Resolution, TraceOptions, TraceResult } from "./settings";
import type { Size, TraceRequest, TraceResponse, TraceTimings } from "./protocol";

export type TraceOutcome = { result: TraceResult; rawNodes: number; source: Size; timings: TraceTimings; memoryBytes: number };

/** Rejection reason when a newer trace or `cancel()` replaced this one. */
export class TraceCanceled extends Error {
  constructor() {
    super("Trace canceled");
    this.name = "TraceCanceled";
  }
}

const TIMEOUT_MS = 90_000;
/** Replace the worker once its WebAssembly memory has grown past this. */
const RECYCLE_BYTES = 512 * 1024 * 1024;

type Pending = {
  id: number;
  resolve: (o: TraceOutcome) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class VectorizeClient {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private nextId = 1;

  trace(req: { file: Blob; fileKey: string; resolution: Resolution; options: TraceOptions; simplify: number }): Promise<TraceOutcome> {
    // The worker is busy with a stale trace; ending it is the only way to stop it.
    if (this.pending) this.cancel();
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<TraceOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error("Tracing took too long. Try a lower resolution, fewer colours or more speckle filtering."));
      }, TIMEOUT_MS);
      this.pending = { id, resolve, reject, timer };
      const msg: TraceRequest = { type: "trace", id, ...req };
      worker.postMessage(msg);
    });
  }

  /** Stops the current trace, if any. */
  cancel() {
    if (this.pending) this.fail(new TraceCanceled());
  }

  dispose() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "vectorize" });
    worker.onmessage = (e: MessageEvent<TraceResponse>) => this.receive(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      this.fail(new Error("The tracing worker stopped unexpectedly."));
    };
    this.worker = worker;
    return worker;
  }

  private receive(msg: TraceResponse) {
    const p = this.pending;
    if (!p || msg.id !== p.id) return; // a reply from a trace that was already given up on
    clearTimeout(p.timer);
    this.pending = null;
    if (msg.type === "result") {
      if (msg.memoryBytes > RECYCLE_BYTES) this.recycle();
      p.resolve({ result: msg.result, rawNodes: msg.rawNodes, source: msg.source, timings: msg.timings, memoryBytes: msg.memoryBytes });
    } else {
      if (msg.fatal) this.recycle();
      p.reject(new Error(msg.message));
    }
  }

  /** Rejects the current trace and throws the worker away. */
  private fail(err: Error) {
    const p = this.pending;
    this.pending = null;
    this.recycle();
    if (p) {
      clearTimeout(p.timer);
      p.reject(err);
    }
  }

  private recycle() {
    this.worker?.terminate();
    this.worker = null;
  }
}
