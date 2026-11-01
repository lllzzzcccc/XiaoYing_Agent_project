import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { executePlanningRun } from "../agent/orchestrator.js";
import { createOfflineRuntime } from "../agent/offline.js";
import { ConfigurationError, createRealRuntime } from "../agent/provider.js";
import { InputValidationError, parsePlanningRequest } from "../domain/request.js";
import { createInitialResult, type RunMode, type RunResult } from "../domain/result.js";
import { RequestStore } from "../store/request-store.js";
import type { ToolFaults } from "../tools/errors.js";
import type { Material } from "../tools/materials.js";
import type { CostItem } from "../domain/planning.js";
import { parseCliArgs } from "./args.js";

export interface CliRunOutcome {
  result: RunResult;
  exitCode: number;
}

function errorResult(requestId: string, mode: RunMode, code: string, message: string): RunResult {
  const result = createInitialResult(requestId, mode);
  result.reasons = [{ code, message }];
  return result;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function maxToolCalls(env: NodeJS.ProcessEnv): number {
  const value = env.CONTENT_PLANNER_MAX_TOOL_CALLS;
  if (!value) return 12;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ConfigurationError("CONTENT_PLANNER_MAX_TOOL_CALLS 必须是正整数");
  }
  return parsed;
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<CliRunOutcome> {
  let mode: RunMode = "real";
  let requestId = "unknown";
  try {
    const options = parseCliArgs(argv);
    mode = options.offline ? "mock" : "real";
    const text = await readFile(options.input, "utf8");
    const parsed = parsePlanningRequest(text);
    requestId = parsed.request.request_id;
    const runtime = options.offline ? null : createRealRuntime(env);
    const store = new RequestStore(options.runtimeDir);
    const requestInput = {
      request: parsed.request,
      originalInput: parsed.originalInput,
      mode,
      maxToolCalls: maxToolCalls(env),
    };
    const opened = options.resume
      ? await store.resumeRequest(requestInput)
      : await store.beginRequest(requestInput);
    if (opened.kind === "duplicate") {
      return { result: opened.result, exitCode: opened.result.status === "completed" ? 0 : 1 };
    }
    if (opened.kind === "conflict" || opened.kind === "unsupported") return { result: opened.result, exitCode: 2 };

    const dataRoot = fileURLToPath(new URL("../../../data/", import.meta.url));
    const [materials, costItems] = await Promise.all([
      readJson<Material[]>(`${dataRoot}materials.json`),
      readJson<CostItem[]>(`${dataRoot}cost-items.json`),
    ]);
    const faults = options.faults ? await readJson<ToolFaults>(options.faults) : undefined;
    const state = opened.record;
    const agentRuntime = options.offline ? createOfflineRuntime(state, costItems.map((item) => item.cost_item_id)) : runtime!;
    const result = await executePlanningRun(state, {
      ...agentRuntime,
      store,
      materials,
      costItems,
      ...(faults ? { faults } : {}),
    });
    return { result, exitCode: result.status === "completed" ? 0 : 1 };
  } catch (error) {
    if (error instanceof InputValidationError) {
      const original = error.originalInput;
      if (typeof original?.request_id === "string" && original.request_id.trim()) requestId = original.request_id;
      const result = createInitialResult(requestId, mode);
      result.reasons = error.reasons;
      return { result, exitCode: 2 };
    }
    const code = error instanceof ConfigurationError ? "MODEL_UNAVAILABLE" : "INPUT_INVALID";
    const result = errorResult(requestId, mode, code, error instanceof Error ? error.message : String(error));
    return { result, exitCode: 2 };
  }
}
