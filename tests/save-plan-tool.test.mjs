import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const saveModule = import("../dist/src/tools/save-plan.js");
const storeModule = import("../dist/src/store/request-store.js");
const materialsModule = import("../dist/src/tools/materials.js");
const scriptModule = import("../dist/src/tools/scripts.js");
const estimateModule = import("../dist/src/tools/estimates.js");
const errorsModule = import("../dist/src/tools/errors.js");

const material = { material_id: "M01", title: "素材", summary: "摘要", facts: ["支持字幕"], tags: ["新品"] };
const costs = [
  { cost_item_id: "lite", unit_cost: 8, duration_seconds: 60 },
  { cost_item_id: "expensive", unit_cost: 12, duration_seconds: 600 },
];

function plan(id = "plan-a", costItem = "lite") {
  return {
    plan_id: id,
    title: id,
    steps: [{ step_id: "s1", title: "制作", cost_item_id: costItem, depends_on: [], quantity: 1 }],
  };
}

async function setup() {
  const { RequestStore } = await storeModule;
  const { executeSearchMaterials } = await materialsModule;
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "content-planner-save-"));
  const store = new RequestStore(runtimeDir);
  const opened = await store.beginRequest({
    request: { request_id: "req-save", theme: "新品", budget: 10, deadline: "2026-11-02T10:03:00Z" },
    originalInput: { request_id: "req-save", theme: "新品", budget: 10, deadline: "2026-11-02T10:03:00Z" },
    mode: "mock",
    startedAt: "2026-11-02T10:00:00Z",
  });
  const state = opened.record;
  executeSearchMaterials(state, [material], { query: "新品" });
  return { store, state };
}

async function prepareValid(state) {
  const { executeGenerateScript } = await scriptModule;
  const { executeEstimateCost } = await estimateModule;
  executeGenerateScript(state, { plan: plan(), material_ids: ["M01"] });
  executeEstimateCost(state, costs, { plan: plan() });
}

test("valid save is independently readable and equivalent repeat save returns the same file", async () => {
  const { executeSavePlan } = await saveModule;
  const { store, state } = await setup();
  await prepareValid(state);
  const saved = await executeSavePlan(state, store, { plan_id: "plan-a" });

  assert.equal(saved.already_saved, false);
  assert.equal(state.saved_plan.path, store.planPath("req-save"));
  const document = JSON.parse(await readFile(saved.path, "utf8"));
  assert.equal(document.schema_version, 1);
  assert.deepEqual(document.original_input, state.original_input);
  assert.equal(document.current_plan.plan_fingerprint, state.current_plan_fingerprint);
  assert.equal(document.script.plan_fingerprint, state.current_plan_fingerprint);
  assert.equal(document.material_references[0].material_id, "M01");
  assert.equal(document.cost.current.total_cost, 8);
  assert.equal(document.duration.current.total_duration_seconds, 60);
  assert.ok(document.saved_at);

  const repeated = await executeSavePlan(state, store, { plan_id: "plan-a" });
  assert.equal(repeated.already_saved, true);
  assert.equal(repeated.path, saved.path);
  assert.equal((await readdir(path.dirname(saved.path))).length, 1);
});

test("infeasible or stale plan dependencies cannot save", async () => {
  const { executeSavePlan } = await saveModule;
  const { executeGenerateScript } = await scriptModule;
  const { executeEstimateCost } = await estimateModule;
  const { ToolError } = await errorsModule;
  const { store, state } = await setup();
  executeGenerateScript(state, { plan: plan("plan-a", "expensive"), material_ids: ["M01"] });
  executeEstimateCost(state, costs, { plan: plan("plan-a", "expensive") });

  await assert.rejects(executeSavePlan(state, store, { plan_id: "plan-a" }), ToolError);
  assert.equal(state.saved_plan, null);

  await prepareValid(state);
  executeGenerateScript(state, { plan: { ...plan(), title: "已改变" }, material_ids: ["M01"] });
  executeEstimateCost(state, costs, { plan: { ...plan(), title: "已改变" } });
  state.scripts.at(-1).valid = false;
  await assert.rejects(executeSavePlan(state, store, { plan_id: "plan-a" }), ToolError);
  assert.equal(state.saved_plan, null);
});

test("injected save failure leaves no saved reference or saved file", async () => {
  const { executeSavePlan } = await saveModule;
  const { store, state } = await setup();
  await prepareValid(state);

  await assert.rejects(
    executeSavePlan(state, store, { plan_id: "plan-a" }, {
      save_plan: { message: "injected save failure" },
    }),
  );
  assert.equal(state.saved_plan, null);
  await assert.rejects(readFile(store.planPath("req-save"), "utf8"));
});

test("a different plan cannot overwrite an existing saved plan", async () => {
  const { executeSavePlan } = await saveModule;
  const { executeGenerateScript } = await scriptModule;
  const { executeEstimateCost } = await estimateModule;
  const { ToolError } = await errorsModule;
  const { store, state } = await setup();
  await prepareValid(state);
  await executeSavePlan(state, store, { plan_id: "plan-a" });

  executeGenerateScript(state, { plan: plan("plan-b"), material_ids: ["M01"] });
  executeEstimateCost(state, costs, { plan: plan("plan-b") });
  await assert.rejects(executeSavePlan(state, store, { plan_id: "plan-b" }), (error) => {
    assert.ok(error instanceof ToolError);
    assert.equal(error.code, "SAVE_CONFLICT");
    return true;
  });
  assert.equal(state.saved_plan.plan_id, "plan-a");
});
