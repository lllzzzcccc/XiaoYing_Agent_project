import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

const orchestratorModule = import("../dist/src/agent/orchestrator.js");
const storeModule = import("../dist/src/store/request-store.js");

const materials = [
  { material_id: "M01", title: "春季新品", summary: "新品素材", facts: ["支持字幕"], tags: ["春季", "新品"] },
];
const costs = [
  { cost_item_id: "premium", unit_cost: 12, duration_seconds: 600 },
  { cost_item_id: "lite", unit_cost: 4, duration_seconds: 60 },
  { cost_item_id: "mid", unit_cost: 8, duration_seconds: 120 },
];

function plan(id, costItem) {
  return {
    plan_id: id,
    title: id,
    steps: [{ step_id: "s1", title: "制作", cost_item_id: costItem, depends_on: [], quantity: 1 }],
  };
}

function call(name, args, note = "根据观察选择动作") {
  return fauxAssistantMessage([fauxText(note), fauxToolCall(name, args)], { stopReason: "toolUse" });
}

async function setup({ budget = 10, deadline = "2026-11-02T11:00:00Z", faults } = {}) {
  const { RequestStore } = await storeModule;
  const store = new RequestStore(await mkdtemp(path.join(tmpdir(), "content-planner-e2e-")));
  const opened = await store.beginRequest({
    request: { request_id: "req-e2e", theme: "春季新品", budget, deadline },
    originalInput: { request_id: "req-e2e", theme: "春季新品", budget, deadline },
    mode: "mock",
    startedAt: "2026-11-02T10:00:00Z",
  });
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return {
    state: opened.record,
    store,
    faux,
    options: {
      model: faux.getModel(),
      streamFn: models.streamSimple.bind(models),
      materials,
      costItems: costs,
      faults,
    },
  };
}

test("normal and over-budget replan runs complete from actual saved state", async () => {
  const { executePlanningRun } = await orchestratorModule;
  const { state, store, faux, options } = await setup();
  faux.setResponses([
    call("search_materials", { query: "春季" }),
    call("estimate_cost", { plan: plan("initial", "premium") }),
    call("estimate_cost", { plan: plan("alternative", "lite") }, "初始方案超预算，选择轻量方案"),
    call("generate_script", { plan: plan("alternative", "lite"), material_ids: ["M01"] }),
    call("save_plan", { plan_id: "alternative" }),
    fauxAssistantMessage("完成"),
  ]);

  const result = await executePlanningRun(state, { ...options, store });
  assert.equal(result.status, "completed");
  assert.equal(result.duplicate, false);
  assert.equal(result.saved_plan.plan_id, "alternative");
  assert.equal(result.current_cost.current.total_cost, 4);
  assert.equal(result.current_cost.history.length, 2);
  assert.equal(result.reasons.length, 0);
  assert.equal(result.task_plan.plan_id, "alternative");
  assert.ok(result.steps.every((step) => step.status === "succeeded"));
  assert.equal(state.original_result.status, "completed");
});

test("save failure returns incomplete while retaining successful prior steps", async () => {
  const { executePlanningRun } = await orchestratorModule;
  const { state, store, faux, options } = await setup({ faults: { save_plan: { message: "save failed" } } });
  faux.setResponses([
    call("search_materials", { query: "春季" }),
    call("estimate_cost", { plan: plan("alternative", "lite") }),
    call("generate_script", { plan: plan("alternative", "lite"), material_ids: ["M01"] }),
    call("save_plan", { plan_id: "alternative" }),
    fauxAssistantMessage("保存失败"),
  ]);

  const result = await executePlanningRun(state, { ...options, store });
  assert.equal(result.status, "incomplete");
  assert.equal(result.saved_plan, null);
  assert.ok(result.reasons.some((reason) => reason.code === "SAVE_FAILED"));
  assert.equal(result.steps.filter((step) => step.status === "succeeded").length, 3);
  assert.equal(result.steps.at(-1).status, "failed");
});

test("no feasible plan returns minimum budget gap and both constraint reasons", async () => {
  const { executePlanningRun } = await orchestratorModule;
  const { state, store, faux, options } = await setup({ budget: 5, deadline: "2026-11-02T10:01:00Z" });
  faux.setResponses([
    call("search_materials", { query: "春季" }),
    call("estimate_cost", { plan: plan("initial", "premium") }),
    call("estimate_cost", { plan: plan("alternative", "mid") }, "继续评估较低费用方案"),
    fauxAssistantMessage("无可行方案"),
  ]);

  const result = await executePlanningRun(state, { ...options, store });
  const codes = result.reasons.map((reason) => reason.code);
  assert.equal(result.status, "incomplete");
  assert.ok(codes.includes("BUDGET_EXCEEDED"));
  assert.ok(codes.includes("DEADLINE_EXCEEDED"));
  assert.equal(result.reasons.find((reason) => reason.code === "BUDGET_EXCEEDED").budget_gap, 3);
  assert.equal(result.saved_plan, null);
});

test("repeated empty searches end with NO_MATERIALS", async () => {
  const { executePlanningRun } = await orchestratorModule;
  const { state, store, faux, options } = await setup();
  faux.setResponses([
    call("search_materials", { query: "不存在" }),
    call("search_materials", { query: "仍不存在" }, "调整查询再次检索"),
    fauxAssistantMessage("无素材"),
  ]);

  const result = await executePlanningRun(state, { ...options, store });
  assert.equal(result.status, "incomplete");
  assert.ok(result.reasons.some((reason) => reason.code === "NO_MATERIALS"));
  assert.equal(result.tool_results.filter((entry) => entry.result_summary.count === 0).length, 2);
});

test("tool failure and early model stop produce truthful incomplete reasons", async () => {
  const { executePlanningRun } = await orchestratorModule;
  const failedRun = await setup({ faults: { estimate_cost: { message: "estimate failed" } } });
  failedRun.faux.setResponses([
    call("search_materials", { query: "春季" }),
    call("estimate_cost", { plan: plan("alternative", "lite") }),
    fauxAssistantMessage("工具失败"),
  ]);
  const failed = await executePlanningRun(failedRun.state, { ...failedRun.options, store: failedRun.store });
  assert.equal(failed.status, "incomplete");
  assert.ok(failed.reasons.some((reason) => reason.code === "TOOL_FAILED"));
  assert.equal(failed.steps[0].status, "succeeded");

  const stoppedRun = await setup();
  stoppedRun.faux.setResponses([fauxAssistantMessage("无法继续")]);
  const stopped = await executePlanningRun(stoppedRun.state, { ...stoppedRun.options, store: stoppedRun.store });
  assert.equal(stopped.status, "incomplete");
  assert.ok(stopped.reasons.some((reason) => reason.code === "AGENT_STOPPED"));
});
