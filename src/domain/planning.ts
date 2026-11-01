import { Decimal } from "decimal.js";
import { fingerprintJson } from "./fingerprint.js";

export interface CampaignStep {
  step_id: string;
  title: string;
  cost_item_id: string;
  depends_on: string[];
  quantity?: number;
}

export interface CampaignPlan {
  plan_id: string;
  title: string;
  steps: CampaignStep[];
}

export interface CostItem {
  cost_item_id: string;
  unit_cost: number;
  duration_seconds: number;
  description?: string;
}

export interface EvaluationContext {
  budget: number;
  deadline: string;
  startedAt: string;
}

export interface EstimateItem {
  step_id: string;
  cost_item_id: string;
  quantity: number;
  unit_cost: number;
  subtotal_cost: number;
  subtotal_duration_seconds: number;
}

export interface PlanEstimate {
  plan_id: string;
  plan_fingerprint: string;
  items: EstimateItem[];
  total_cost: number;
  total_duration_seconds: number;
  started_at: string;
  estimated_completion_at: string;
  budget: number;
  deadline: string;
  budget_feasible: boolean;
  time_feasible: boolean;
  feasible: boolean;
  budget_gap: number;
}

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

export function planFingerprint(plan: CampaignPlan): string {
  return fingerprintJson(plan);
}

function validatePlan(plan: CampaignPlan, costItems: CostItem[]): Map<string, CostItem> {
  if (!plan || typeof plan.plan_id !== "string" || plan.plan_id.trim() === "") {
    throw new PlanValidationError("plan_id 必须是非空字符串");
  }
  if (typeof plan.title !== "string" || plan.title.trim() === "") {
    throw new PlanValidationError("方案标题必须非空");
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new PlanValidationError("方案至少包含一个业务步骤");
  }

  const catalog = new Map(costItems.map((item) => [item.cost_item_id, item]));
  const steps = new Map<string, CampaignStep>();
  for (const step of plan.steps) {
    if (!step.step_id || steps.has(step.step_id)) {
      throw new PlanValidationError("业务步骤 ID 必须非空且唯一");
    }
    if (!step.title || !catalog.has(step.cost_item_id)) {
      throw new PlanValidationError(`步骤 ${step.step_id} 的标题或费用项无效`);
    }
    if (!Array.isArray(step.depends_on)) {
      throw new PlanValidationError(`步骤 ${step.step_id} 的依赖无效`);
    }
    if (step.quantity !== undefined && (!Number.isInteger(step.quantity) || step.quantity < 1)) {
      throw new PlanValidationError(`步骤 ${step.step_id} 的数量必须是正整数`);
    }
    steps.set(step.step_id, step);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(stepId: string): void {
    if (visiting.has(stepId)) throw new PlanValidationError("业务步骤依赖存在循环");
    if (visited.has(stepId)) return;
    const step = steps.get(stepId);
    if (!step) throw new PlanValidationError(`依赖步骤 ${stepId} 不存在`);
    visiting.add(stepId);
    for (const dependency of step.depends_on) visit(dependency);
    visiting.delete(stepId);
    visited.add(stepId);
  }
  for (const stepId of steps.keys()) visit(stepId);
  return catalog;
}

export function evaluateCampaignPlan(
  plan: CampaignPlan,
  costItems: CostItem[],
  context: EvaluationContext,
): PlanEstimate {
  const catalog = validatePlan(plan, costItems);
  const startedMs = Date.parse(context.startedAt);
  const deadlineMs = Date.parse(context.deadline);
  if (!Number.isFinite(startedMs) || !Number.isFinite(deadlineMs)) {
    throw new PlanValidationError("开始时间或截止时间无效");
  }

  let totalCost = new Decimal(0);
  let totalDuration = 0;
  const items = plan.steps.map((step): EstimateItem => {
    const costItem = catalog.get(step.cost_item_id)!;
    const quantity = step.quantity ?? 1;
    if (!Number.isFinite(costItem.unit_cost) || costItem.unit_cost < 0 ||
        !Number.isInteger(costItem.duration_seconds) || costItem.duration_seconds < 0) {
      throw new PlanValidationError(`费用项 ${costItem.cost_item_id} 的费用或耗时无效`);
    }
    const subtotalCost = new Decimal(costItem.unit_cost).times(quantity);
    const subtotalDuration = costItem.duration_seconds * quantity;
    totalCost = totalCost.plus(subtotalCost);
    totalDuration += subtotalDuration;
    if (!Number.isSafeInteger(totalDuration)) throw new PlanValidationError("方案总耗时超出安全范围");
    return {
      step_id: step.step_id,
      cost_item_id: step.cost_item_id,
      quantity,
      unit_cost: costItem.unit_cost,
      subtotal_cost: subtotalCost.toNumber(),
      subtotal_duration_seconds: subtotalDuration,
    };
  });

  const totalCostNumber = totalCost.toNumber();
  const estimatedMs = startedMs + totalDuration * 1000;
  const budgetGap = Decimal.max(totalCost.minus(context.budget), 0).toNumber();
  const budgetFeasible = totalCost.lessThanOrEqualTo(context.budget);
  const timeFeasible = estimatedMs <= deadlineMs;

  return {
    plan_id: plan.plan_id,
    plan_fingerprint: planFingerprint(plan),
    items,
    total_cost: totalCostNumber,
    total_duration_seconds: totalDuration,
    started_at: context.startedAt,
    estimated_completion_at: new Date(estimatedMs).toISOString(),
    budget: context.budget,
    deadline: context.deadline,
    budget_feasible: budgetFeasible,
    time_feasible: timeFeasible,
    feasible: budgetFeasible && timeFeasible,
    budget_gap: budgetGap,
  };
}

export function minimumBudgetGap(
  estimates: Array<Pick<PlanEstimate, "total_cost">>,
  budget: number,
): number | null {
  if (estimates.length === 0) return null;
  const minimum = estimates.reduce(
    (current, estimate) => Decimal.min(current, estimate.total_cost),
    new Decimal(estimates[0]!.total_cost),
  );
  return Decimal.max(minimum.minus(budget), 0).toNumber();
}
