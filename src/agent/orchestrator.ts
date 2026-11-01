import { minimumBudgetGap } from "../domain/planning.js";
import { createInitialResult, type ResultReason, type RunResult } from "../domain/result.js";
import type { RunState } from "../domain/run-state.js";
import { currentEstimate } from "../tools/estimates.js";
import { runPiAgent, type PiAgentRunOptions } from "./pi-agent.js";

function addReason(reasons: ResultReason[], reason: ResultReason): void {
  if (!reasons.some((existing) => existing.code === reason.code && existing.step_id === reason.step_id)) {
    reasons.push(reason);
  }
}

function hasCurrentScript(state: RunState): boolean {
  return state.scripts.some((script) =>
    script.valid &&
    script.plan_id === state.current_plan_id &&
    script.plan_fingerprint === state.current_plan_fingerprint
  );
}

export function finalizeRunState(state: RunState): RunResult {
  const estimate = currentEstimate(state);
  const completed = state.saved_plan !== null && estimate?.feasible === true && hasCurrentScript(state);
  const reasons = completed ? [] : [...state.reasons];

  if (!completed) {
    const failedSave = state.steps.find((step) => step.tool_name === "save_plan" && step.status === "failed");
    if (failedSave) {
      addReason(reasons, { code: "SAVE_FAILED", message: "方案保存失败", step_id: failedSave.step_id });
    }
    const failedTool = state.steps.find((step) => step.tool_name !== "save_plan" && step.status === "failed");
    if (failedTool) {
      addReason(reasons, { code: "TOOL_FAILED", message: `工具 ${failedTool.tool_name} 执行失败`, step_id: failedTool.step_id });
    }

    if (state.material_searches.length > 0 &&
        state.material_searches.every((search) => search.count === 0) &&
        Object.keys(state.plans).length === 0) {
      addReason(reasons, { code: "NO_MATERIALS", message: "调整查询后仍无可用素材" });
    }

    const anyFeasible = state.estimates.some((entry) => entry.valid && entry.feasible);
    if (state.estimates.length > 0 && !anyFeasible) {
      if (state.estimates.some((entry) => !entry.budget_feasible)) {
        const gap = minimumBudgetGap(state.estimates, state.request.budget);
        addReason(reasons, {
          code: "BUDGET_EXCEEDED",
          message: "没有满足预算的候选方案",
          ...(gap === null ? {} : { budget_gap: gap }),
        });
      }
      if (state.estimates.some((entry) => !entry.time_feasible)) {
        const latest = state.estimates.at(-1)!;
        addReason(reasons, {
          code: "DEADLINE_EXCEEDED",
          message: "没有满足截止时间的候选方案",
          estimated_completion_at: latest.estimated_completion_at,
        });
      }
    }

    if (reasons.length === 0) {
      addReason(reasons, { code: "AGENT_STOPPED", message: "模型在保存完成方案前停止" });
    }
  }

  const plan = state.current_plan_id ? state.plans[state.current_plan_id] : undefined;
  const result = createInitialResult(state.request_id, state.mode);
  result.status = completed ? "completed" : "incomplete";
  result.task_plan = plan ? {
    ...structuredClone(plan.plan),
    plan_fingerprint: plan.plan_fingerprint,
  } : null;
  result.steps = state.steps.map((step) => structuredClone(step) as unknown as Record<string, unknown>);
  result.tool_results = state.steps.map((step) => ({
    step_id: step.step_id,
    tool_name: step.tool_name,
    status: step.status,
    result_summary: structuredClone(step.result_summary),
    error: structuredClone(step.error),
  }));
  result.current_cost = state.estimates.length > 0 ? {
    current: estimate ? structuredClone(estimate) : null,
    history: structuredClone(state.estimates),
  } : null;
  result.duration = estimate ? {
    total_duration_seconds: estimate.total_duration_seconds,
    started_at: estimate.started_at,
    estimated_completion_at: estimate.estimated_completion_at,
  } : null;
  result.saved_plan = state.saved_plan ? structuredClone(state.saved_plan) as unknown as Record<string, unknown> : null;
  result.reasons = reasons;
  result.trace.path = state.trace_path;
  return result;
}

export async function executePlanningRun(state: RunState, options: PiAgentRunOptions): Promise<RunResult> {
  try {
    await runPiAgent(state, options);
  } catch (error) {
    state.reasons.push({
      code: "MODEL_UNAVAILABLE",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const result = finalizeRunState(state);
  state.reasons = result.reasons;
  await options.store.finalize(state, result);
  return result;
}
