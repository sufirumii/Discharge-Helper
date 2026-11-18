/**
 * client — the UI's entry point into the reading engine. Spins up the worker,
 * streams trace steps for live progress, and resolves with the full result.
 * A synchronous in-thread path (runAgent) exists for tests and the eval.
 */

import type { AnalysisResult, EngineOptions, TraceStep } from "./types";

export type Analyse = (
  text: string,
  options: EngineOptions,
  onTrace?: (step: TraceStep) => void,
) => Promise<AnalysisResult>;

let workerModule: Promise<typeof import("./worker")> | null = null;

/**
 * Analyse in the worker. Falls back to the in-thread agent when workers are
 * unavailable (very old browsers, some test environments).
 */
export const analyse: Analyse = async (text, options, onTrace) => {
  if (typeof Worker === "undefined") {
    const { runAgent } = await import("./agent");
    return runAgent(text, options, onTrace);
  }
  try {
    workerModule ??= import("./worker");
    await workerModule;
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    return await new Promise<AnalysisResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("Reading the papers took too long. Try a shorter document."));
      }, 30_000);
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as
          | { kind: "trace"; step: TraceStep }
          | { kind: "done"; result: AnalysisResult }
          | { kind: "error"; message: string };
        if (msg.kind === "trace") {
          onTrace?.(msg.step);
        } else if (msg.kind === "done") {
          clearTimeout(timeout);
          worker.terminate();
          resolve(msg.result);
        } else {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (err) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(err.message || "The reading engine failed on this document."));
      };
      worker.postMessage({ kind: "analyse", text, options });
    });
  } catch {
    const { runAgent } = await import("./agent");
    return runAgent(text, options, onTrace);
  }
};
