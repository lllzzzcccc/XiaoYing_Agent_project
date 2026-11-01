import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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

const agentModule = import("../dist/src/agent/pi-agent.js");
const storeModule = import("../dist/src/store/request-store.js");

const materials = [
  { material_id: "M01", title: "春季新品", summary: "新品素材", facts: ["支持字幕"], tags: ["春季", "新品"] },
];
const costs = [
  { cost_item_id: "premium", unit_cost: 12, duration_seconds: 60 },
  { cost_item_id: "lite", unit_cost: 4, duration_seconds: 60 },
];

function plan(id, costItem) {
  return {
    plan_id: id,
    title: id,
    steps: [{ step_id: "s1", title: "制作", cost_item_id: costItem, depends_on: [], quantity: 1 }],
  };
}

function call(name, args, note) {
  return fauxAssistantMessage([fauxText(note), fauxToolCall(name, args)], { stopReason: "toolUse" });
}

async function setup({ budget = 10, maxToolCalls = 12, faults } = {}) {
  const { RequestStore } = await storeModule;
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "content-planner-agent-"));
  const store = new RequestStore(runtimeDir);
  const opened = await store.beginRequest({
    request: { request_id: "req-agent", theme: "春季新品", budget, deadline: "2026-11-02T11:00:00Z" },
    originalInput: { request_id: "req-agent", theme: "春季新品", budget, deadline: "2026-11-02T11:00:00Z" },
    mode: "mock",
    startedAt: "2026-11-02T10:00:00Z",
    maxToolCalls,
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

test("Pi agent observes over-budget result, replans, and saves through sequential tools", async () => {
  const { runPiAgent } = await agentModule;
  const { state, store, faux, options } = await setup();
  faux.setResponses([
    call("search_materials", { query: "春季" }, "先检索主题素材"),
    call("estimate_cost", { plan: plan("initial", "premium") }, "先估算完整方案"),
    call("estimate_cost", { plan: plan("alternative", "lite") }, "初始方案超预算，改估轻量方案"),
    call("generate_script", { plan: plan("alternative", "lite"), material_ids: ["M01"] }, "轻量方案可行，生成匹配脚本"),
    call("save_plan", { plan_id: "alternative" }, "脚本和估算均匹配，保存方案"),
    fauxAssistantMessage("方案已完成"),
  ]);

  await runPiAgent(state, { ...options, store });

  assert.deepEqual(state.steps.map((step) => step.tool_name), [
    "search_materials",
    "estimate_cost",
    "estimate_cost",
    "generate_script",
    "save_plan",
  ]);
  assert.ok(state.steps.every((step) => step.status === "succeeded"));
  assert.equal(state.estimates.length, 2);
  assert.equal(state.saved_plan.plan_id, "alternative");
  assert.equal(state.tool_call_count, 5);

  const trace = await readFile(state.trace_path, "utf8");
  assert.ok(trace.includes("初始方案超预算，改估轻量方案"));
  assert.ok(trace.includes("estimate_cost"));
  assert.ok(trace.includes("save_plan"));
  assert.ok(trace.includes("end"));
});

test("tool failure is observed while successful history is retained", async () => {
  const { runPiAgent } = await agentModule;
  const { state, store, faux, options } = await setup({
    faults: { generate_script: { message: "injected script failure" } },
  });
  faux.setResponses([
    call("search_materials", { query: "春季" }, "先检索素材"),
    call("estimate_cost", { plan: plan("alternative", "lite") }, "估算轻量方案"),
    call("generate_script", { plan: plan("alternative", "lite"), material_ids: ["M01"] }, "尝试生成脚本"),
    fauxAssistantMessage("脚本工具失败，停止执行"),
  ]);

  await runPiAgent(state, { ...options, store });

  assert.deepEqual(state.steps.map((step) => step.status), ["succeeded", "succeeded", "failed"]);
  assert.equal(state.material_searches.length, 1);
  assert.equal(state.estimates.length, 1);
  assert.equal(state.saved_plan, null);
  assert.equal(state.steps.at(-1).error.code, "INJECTED_FAILURE");
  const trace = await readFile(state.trace_path, "utf8");
  assert.ok(trace.includes("INJECTED_FAILURE"));
});

test("tool call limit blocks further execution and preserves the accepted call count", async () => {
  const { runPiAgent } = await agentModule;
  const { state, store, faux, options } = await setup({ maxToolCalls: 1 });
  faux.setResponses([
    call("search_materials", { query: "春季" }, "先检索一次"),
    call("estimate_cost", { plan: plan("alternative", "lite") }, "尝试超过上限"),
  ]);

  await runPiAgent(state, { ...options, store });

  assert.equal(state.tool_call_count, 1);
  assert.equal(state.steps.length, 1);
  assert.equal(state.limit_reached, true);
  assert.ok(state.reasons.some((reason) => reason.code === "EXECUTION_LIMIT_REACHED"));
  assert.equal(state.saved_plan, null);
});
