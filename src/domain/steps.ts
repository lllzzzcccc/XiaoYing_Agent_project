import { randomUUID } from "node:crypto";
import type { RunState, RunStep, RunStepStatus, ToolErrorInfo } from "./run-state.js";

const allowedTransitions: Record<RunStepStatus, RunStepStatus[]> = {
  pending: ["running", "blocked", "skipped"],
  running: ["succeeded", "failed", "blocked"],
  succeeded: ["invalidated"],
  failed: ["skipped"],
  blocked: ["pending", "skipped"],
  skipped: [],
  invalidated: [],
};

export function transitionRunStep(step: RunStep, next: RunStepStatus): void {
  if (!allowedTransitions[step.status].includes(next)) {
    throw new Error(`运行步骤不得从 ${step.status} 迁移到 ${next}`);
  }
  step.status = next;
  if (next !== "pending" && next !== "running") step.finished_at = new Date().toISOString();
}

export function startRunStep(state: RunState, options: {
  toolCallId: string;
  toolName: string;
  args: unknown;
  dependsOn?: string[];
  planId?: string;
  planFingerprint?: string;
}): RunStep {
  const attempt = state.steps.filter((step) => step.tool_name === options.toolName).length + 1;
  const step: RunStep = {
    step_id: `step-${randomUUID()}`,
    tool_call_id: options.toolCallId,
    tool_name: options.toolName,
    attempt,
    status: "pending",
    depends_on: [...(options.dependsOn ?? [])],
    args: structuredClone(options.args),
    result_summary: null,
    error: null,
    plan_id: options.planId ?? null,
    plan_fingerprint: options.planFingerprint ?? null,
    started_at: new Date().toISOString(),
    finished_at: null,
  };
  transitionRunStep(step, "running");
  state.steps.push(step);
  state.tool_call_count += 1;
  return step;
}

export function finishRunStep(
  state: RunState,
  step: RunStep,
  outcome: {
    status: "succeeded" | "failed" | "blocked";
    resultSummary?: unknown;
    error?: ToolErrorInfo;
  },
): void {
  if (!state.steps.includes(step)) throw new Error("运行步骤不属于当前状态");
  transitionRunStep(step, outcome.status);
  step.result_summary = outcome.resultSummary ?? null;
  step.error = outcome.error ?? null;
}

export function invalidatePlanSteps(state: RunState, planId: string, planFingerprint: string): void {
  for (const step of state.steps) {
    if (step.status === "succeeded" && step.plan_id === planId && step.plan_fingerprint === planFingerprint) {
      transitionRunStep(step, "invalidated");
    }
  }
}
