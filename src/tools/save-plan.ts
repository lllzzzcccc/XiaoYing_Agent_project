import type { SavedPlanReference, RunState, ScriptRecord } from "../domain/run-state.js";
import { readJsonFile, writeJsonAtomic } from "../store/json-file.js";
import type { RequestStore } from "../store/request-store.js";
import { throwIfInjected, ToolError, type ToolFaults } from "./errors.js";
import { currentEstimate } from "./estimates.js";

export interface SavePlanParams {
  plan_id: string;
}

function currentScript(state: RunState): ScriptRecord | null {
  for (let index = state.scripts.length - 1; index >= 0; index -= 1) {
    const script = state.scripts[index]!;
    if (script.valid &&
        script.plan_id === state.current_plan_id &&
        script.plan_fingerprint === state.current_plan_fingerprint) {
      return script;
    }
  }
  return null;
}

export async function executeSavePlan(
  state: RunState,
  store: RequestStore,
  params: SavePlanParams,
  faults?: ToolFaults,
): Promise<SavedPlanReference> {
  throwIfInjected(faults, "save_plan");
  if (state.saved_plan) {
    if (state.saved_plan.plan_id === params.plan_id &&
        state.saved_plan.plan_fingerprint === state.current_plan_fingerprint) {
      return { ...state.saved_plan, already_saved: true };
    }
    throw new ToolError({ code: "SAVE_CONFLICT", message: "该请求已保存不同方案，禁止覆盖" });
  }
  if (state.limit_reached) {
    throw new ToolError({ code: "DEPENDENCY_NOT_MET", message: "达到执行上限后不得保存" });
  }

  const plan = state.plans[params.plan_id];
  const estimate = currentEstimate(state);
  const script = currentScript(state);
  if (!plan || state.current_plan_id !== params.plan_id ||
      plan.plan_fingerprint !== state.current_plan_fingerprint) {
    throw new ToolError({ code: "DEPENDENCY_NOT_MET", message: "当前候选方案不存在或已失效" });
  }
  if (!estimate || !estimate.feasible) {
    throw new ToolError({ code: "DEPENDENCY_NOT_MET", message: "当前方案没有满足约束的成功估算" });
  }
  if (!script) {
    throw new ToolError({ code: "DEPENDENCY_NOT_MET", message: "当前方案没有匹配的有效脚本" });
  }

  const savedAt = new Date().toISOString();
  const filePath = store.planPath(state.request_id);
  const existing = await readJsonFile<{ plan_fingerprint?: string; saved_at?: string }>(filePath);
  if (existing) {
    throw new ToolError({ code: "SAVE_CONFLICT", message: "保存文件已存在且不属于当前运行" });
  }

  const document = {
    schema_version: 1,
    request_id: state.request_id,
    original_input: state.original_input,
    current_plan: {
      ...plan.plan,
      plan_fingerprint: plan.plan_fingerprint,
    },
    material_references: script.material_references,
    script,
    cost: {
      current: estimate,
      history_estimate_ids: state.estimates.map((entry) => entry.estimate_id),
    },
    duration: {
      current: {
        total_duration_seconds: estimate.total_duration_seconds,
        started_at: estimate.started_at,
        estimated_completion_at: estimate.estimated_completion_at,
      },
      items: estimate.items,
    },
    saved_at: savedAt,
  };

  try {
    await writeJsonAtomic(filePath, document);
    const verified = await readJsonFile<typeof document>(filePath);
    if (!verified || verified.request_id !== state.request_id ||
        verified.current_plan.plan_fingerprint !== plan.plan_fingerprint ||
        !verified.original_input || !verified.script || !verified.cost || !verified.duration ||
        !verified.saved_at) {
      throw new Error("保存文件回读校验失败");
    }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError({
      code: "PERSISTENCE_ERROR",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const reference: SavedPlanReference = {
    request_id: state.request_id,
    plan_id: plan.plan.plan_id,
    plan_fingerprint: plan.plan_fingerprint,
    saved_at: savedAt,
    path: filePath,
    already_saved: false,
  };
  state.saved_plan = reference;
  return structuredClone(reference);
}
