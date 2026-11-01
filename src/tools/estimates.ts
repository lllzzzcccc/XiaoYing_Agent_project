import { randomUUID } from "node:crypto";
import {
  evaluateCampaignPlan,
  PlanValidationError,
  type CampaignPlan,
  type CostItem,
} from "../domain/planning.js";
import type { EstimateRecord, RunState } from "../domain/run-state.js";
import { throwIfInjected, ToolError, type ToolFaults } from "./errors.js";
import { registerPlan } from "./plans.js";

export interface EstimateCostParams {
  plan: CampaignPlan;
}

export function executeEstimateCost(
  state: RunState,
  costItems: CostItem[],
  params: EstimateCostParams,
  faults?: ToolFaults,
): EstimateRecord {
  throwIfInjected(faults, "estimate_cost");
  try {
    const estimate = evaluateCampaignPlan(params.plan, costItems, {
      budget: state.request.budget,
      deadline: state.request.deadline,
      startedAt: state.started_at,
    });
    registerPlan(state, params.plan);
    const record: EstimateRecord = {
      ...estimate,
      estimate_id: `estimate-${randomUUID()}`,
      estimated_at: new Date().toISOString(),
      valid: true,
    };
    state.estimates.push(record);
    return structuredClone(record);
  } catch (error) {
    if (error instanceof PlanValidationError) {
      throw new ToolError({ code: "VALIDATION_ERROR", message: error.message });
    }
    throw error;
  }
}

export function currentEstimate(state: RunState): EstimateRecord | null {
  for (let index = state.estimates.length - 1; index >= 0; index -= 1) {
    const estimate = state.estimates[index]!;
    if (estimate.valid &&
        estimate.plan_id === state.current_plan_id &&
        estimate.plan_fingerprint === state.current_plan_fingerprint) {
      return estimate;
    }
  }
  return null;
}
