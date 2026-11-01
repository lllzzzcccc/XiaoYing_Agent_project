import { planFingerprint, type CampaignPlan } from "../domain/planning.js";
import type { PlanRecord, RunState } from "../domain/run-state.js";

export function registerPlan(state: RunState, plan: CampaignPlan): PlanRecord {
  const fingerprint = planFingerprint(plan);
  const previous = state.plans[plan.plan_id];
  if (previous && previous.plan_fingerprint !== fingerprint) {
    for (const script of state.scripts) {
      if (script.plan_id === plan.plan_id && script.plan_fingerprint === previous.plan_fingerprint) {
        script.valid = false;
      }
    }
    for (const estimate of state.estimates) {
      if (estimate.plan_id === plan.plan_id && estimate.plan_fingerprint === previous.plan_fingerprint) {
        estimate.valid = false;
      }
    }
  }

  for (const record of Object.values(state.plans)) record.current = false;
  const record: PlanRecord = { plan: structuredClone(plan), plan_fingerprint: fingerprint, current: true };
  state.plans[plan.plan_id] = record;
  state.current_plan_id = plan.plan_id;
  state.current_plan_fingerprint = fingerprint;
  return record;
}
