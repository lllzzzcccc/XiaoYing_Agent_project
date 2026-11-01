import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type JsonValue,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { CampaignPlan } from "../domain/planning.js";
import type { RunState } from "../domain/run-state.js";
import { currentEstimate } from "../tools/estimates.js";
import type { PiAgentRunOptions } from "./pi-agent.js";

function plan(id: string, costItemId: string): JsonValue {
  const candidate: CampaignPlan = {
    plan_id: id,
    title: id === "initial" ? "完整内容方案" : "轻量替代方案",
    steps: [{ step_id: "produce", title: "内容制作", cost_item_id: costItemId, depends_on: [], quantity: 1 }],
  };
  return candidate as unknown as JsonValue;
}

function nextOfflineResponse(state: RunState, costItemIds: string[], initialStepCount: number) {
  const latestStep = state.steps.length > initialStepCount ? state.steps.at(-1) : undefined;
  if (latestStep?.status === "failed") return fauxAssistantMessage("工具失败，保留已有结果并停止");

  const initialCostItem = costItemIds.includes("premium") ? "premium" : costItemIds.at(-1)!;
  const alternativeCostItem = costItemIds.includes("social") ? "social" : costItemIds[0]!;
  if (state.material_searches.length === 0) {
    return fauxAssistantMessage([
      fauxText("先按主题检索素材"),
      fauxToolCall("search_materials", { query: state.request.theme }),
    ], { stopReason: "toolUse" });
  }
  if (state.material_searches.every((search) => search.count === 0)) {
    if (state.material_searches.length === 1) {
      return fauxAssistantMessage([
        fauxText("首次无结果，调整查询再试一次"),
        fauxToolCall("search_materials", { query: "其他素材" }),
      ], { stopReason: "toolUse" });
    }
    return fauxAssistantMessage("调整查询后仍无素材，停止");
  }

  const estimate = currentEstimate(state);
  if (!estimate) {
    return fauxAssistantMessage([
      fauxText("先估算完整候选方案"),
      fauxToolCall("estimate_cost", { plan: plan("initial", initialCostItem) }),
    ], { stopReason: "toolUse" });
  }
  if (!estimate.feasible) {
    if (state.current_plan_id !== "alternative") {
      return fauxAssistantMessage([
        fauxText("当前方案不满足约束，改估轻量替代方案"),
        fauxToolCall("estimate_cost", { plan: plan("alternative", alternativeCostItem) }),
      ], { stopReason: "toolUse" });
    }
    return fauxAssistantMessage("替代方案仍不可行，返回约束原因");
  }

  const currentPlan = state.plans[state.current_plan_id!]!.plan;
  const script = state.scripts.some((entry) => entry.valid && entry.plan_fingerprint === state.current_plan_fingerprint);
  if (!script) {
    const materialIds = [...new Set(state.material_searches.flatMap((search) =>
      search.items.map((item) => String(item.material_id))
    ))];
    return fauxAssistantMessage([
      fauxText("当前方案可行，生成引用素材的脚本"),
      fauxToolCall("generate_script", { plan: currentPlan as unknown as JsonValue, material_ids: materialIds }),
    ], { stopReason: "toolUse" });
  }
  if (!state.saved_plan) {
    return fauxAssistantMessage([
      fauxText("脚本和估算匹配，保存方案"),
      fauxToolCall("save_plan", { plan_id: state.current_plan_id }),
    ], { stopReason: "toolUse" });
  }
  return fauxAssistantMessage("方案已保存，结束");
}

export function createOfflineRuntime(state: RunState, costItemIds: string[]): Pick<PiAgentRunOptions, "model" | "streamFn"> {
  const faux = fauxProvider();
  const models = createModels();
  const initialStepCount = state.steps.length;
  models.setProvider(faux.provider);
  const streamFn: StreamFn = (model, context, options) => {
    faux.setResponses([() => nextOfflineResponse(state, costItemIds, initialStepCount)]);
    return models.streamSimple(model, context, options);
  };
  return { model: faux.getModel(), streamFn };
}
