import { createHash } from "node:crypto";
import path from "node:path";
import { fingerprintJson } from "../domain/fingerprint.js";
import type { PlanningRequest } from "../domain/request.js";
import {
  createInitialResult,
  createRequestConflictResult,
  markDuplicateResult,
  type RunMode,
  type RunResult,
} from "../domain/result.js";
import { createRunState, type RunState } from "../domain/run-state.js";
import { readJsonFile, writeJsonAtomic } from "./json-file.js";

interface BeginRequestInput {
  request: PlanningRequest;
  originalInput: Record<string, unknown>;
  mode: RunMode;
  startedAt?: string;
  maxToolCalls?: number;
}

export type BeginRequestResult =
  | { kind: "new"; record: RunState }
  | { kind: "duplicate"; result: RunResult }
  | { kind: "conflict"; result: RunResult };

export function hashRequestId(requestId: string): string {
  return createHash("sha256").update(requestId, "utf8").digest("hex");
}

export class RequestStore {
  readonly runtimeDir: string;

  constructor(runtimeDir: string) {
    this.runtimeDir = path.resolve(runtimeDir);
  }

  requestPath(requestId: string): string {
    return path.join(this.runtimeDir, "requests", `${hashRequestId(requestId)}.json`);
  }

  planPath(requestId: string): string {
    return path.join(this.runtimeDir, "plans", `${hashRequestId(requestId)}.json`);
  }

  tracePath(requestId: string): string {
    return path.join(this.runtimeDir, "traces", `${hashRequestId(requestId)}.jsonl`);
  }

  async load(requestId: string): Promise<RunState | null> {
    return readJsonFile<RunState>(this.requestPath(requestId));
  }

  async save(record: RunState): Promise<void> {
    await writeJsonAtomic(this.requestPath(record.request_id), record);
  }

  async beginRequest(input: BeginRequestInput): Promise<BeginRequestResult> {
    const existing = await this.load(input.request.request_id);
    const inputFingerprint = fingerprintJson(input.originalInput);
    if (existing) {
      if (existing.input_fingerprint !== inputFingerprint) {
        return { kind: "conflict", result: createRequestConflictResult(input.request.request_id, input.mode) };
      }
      if (existing.original_result) {
        return { kind: "duplicate", result: markDuplicateResult(existing.original_result) };
      }

      const interrupted = createInitialResult(input.request.request_id, existing.mode);
      interrupted.reasons = [{ code: "RUN_INTERRUPTED", message: "上次运行在完成前中断" }];
      interrupted.trace.path = existing.trace_path;
      await this.finalize(existing, interrupted);
      return { kind: "duplicate", result: markDuplicateResult(interrupted) };
    }

    const record = createRunState({
      request: input.request,
      originalInput: input.originalInput,
      inputFingerprint,
      mode: input.mode,
      startedAt: input.startedAt ?? new Date().toISOString(),
      maxToolCalls: input.maxToolCalls ?? 12,
      tracePath: this.tracePath(input.request.request_id),
    });
    await this.save(record);
    return { kind: "new", record };
  }

  async finalize(record: RunState, result: RunResult): Promise<void> {
    result.duplicate = false;
    result.trace.path = record.trace_path;
    result.trace.mode = record.mode;
    record.original_result = structuredClone(result);
    record.status = result.status;
    record.finished_at = new Date().toISOString();
    await this.save(record);
  }
}
