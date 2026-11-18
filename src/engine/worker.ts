/**
 * The Discharge Agent worker — all parsing runs here so the UI never freezes.
 * The agent itself is pure code (src/engine/agent.ts); this file only wires
 * the message protocol.
 */

import { runAgent } from "./agent";
import type { AnalysisResult, EngineOptions, TraceStep } from "./types";

export interface AnalyseRequest {
  kind: "analyse";
  text: string;
  options: EngineOptions;
}

export type WorkerMessage =
  | { kind: "trace"; step: TraceStep }
  | { kind: "done"; result: AnalysisResult }
  | { kind: "error"; message: string };

const ctx = self as unknown as {
  postMessage: (m: WorkerMessage) => void;
  addEventListener: (t: "message", h: (e: MessageEvent<AnalyseRequest>) => void) => void;
};

ctx.addEventListener("message", (event) => {
  const req = event.data;
  if (!req || req.kind !== "analyse") return;
  try {
    const result = runAgent(req.text, req.options, (step) => {
      ctx.postMessage({ kind: "trace", step });
    });
    ctx.postMessage({ kind: "done", result });
  } catch (err) {
    ctx.postMessage({
      kind: "error",
      message: err instanceof Error ? err.message : "The reading engine failed on this document.",
    });
  }
});
