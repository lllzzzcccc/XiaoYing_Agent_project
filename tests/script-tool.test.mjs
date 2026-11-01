import assert from "node:assert/strict";
import test from "node:test";

const scriptModule = import("../dist/src/tools/scripts.js");
const materialsModule = import("../dist/src/tools/materials.js");
const errorsModule = import("../dist/src/tools/errors.js");
const stateModule = import("../dist/src/domain/run-state.js");

const materials = [
  { material_id: "M01", title: "素材一", summary: "摘要一", facts: ["支持字幕"], tags: ["新品"] },
  { material_id: "M02", title: "素材二", summary: "摘要二", facts: ["支持草稿导出"], tags: ["功能"] },
];

function plan(title = "方案 A") {
  return {
    plan_id: "plan-a",
    title,
    steps: [{ step_id: "s1", title: "制作", cost_item_id: "draft", depends_on: [], quantity: 1 }],
  };
}

async function makeState() {
  const { createRunState } = await stateModule;
  const { executeSearchMaterials } = await materialsModule;
  const request = { request_id: "req-script", theme: "新品科普", budget: 10, deadline: "2026-12-31T23:59:59Z" };
  const state = createRunState({
    request,
    originalInput: { ...request },
    inputFingerprint: "fingerprint",
    mode: "mock",
    startedAt: "2026-11-02T10:00:00Z",
    maxToolCalls: 12,
    tracePath: "/tmp/trace.jsonl",
  });
  executeSearchMaterials(state, materials, { query: "新品" });
  return state;
}

test("script generation uses only retrieved material facts and records plan fingerprint", async () => {
  const { executeGenerateScript } = await scriptModule;
  const state = await makeState();
  const script = executeGenerateScript(state, { plan: plan(), material_ids: ["M01"] });

  assert.equal(script.plan_id, "plan-a");
  assert.equal(script.plan_fingerprint, state.current_plan_fingerprint);
  assert.deepEqual(script.material_ids, ["M01"]);
  assert.ok(script.content.includes("支持字幕"));
  assert.ok(script.content.includes("M01"));
  assert.equal(state.scripts.length, 1);
  assert.equal(state.scripts[0].valid, true);
});

test("unknown, duplicate, or unretrieved material ids fail without creating a script", async () => {
  const { executeGenerateScript } = await scriptModule;
  const { ToolError } = await errorsModule;
  const state = await makeState();

  for (const materialIds of [["missing"], ["M01", "M01"], ["M02"], []]) {
    assert.throws(
      () => executeGenerateScript(state, { plan: plan(), material_ids: materialIds }),
      (error) => {
        assert.ok(error instanceof ToolError);
        assert.ok(["NOT_FOUND", "DEPENDENCY_NOT_MET", "VALIDATION_ERROR"].includes(error.code));
        return true;
      },
    );
  }
  assert.equal(state.scripts.length, 0);
});

test("changing plan content invalidates old scripts while retaining history", async () => {
  const { executeGenerateScript } = await scriptModule;
  const state = await makeState();
  const original = executeGenerateScript(state, { plan: plan(), material_ids: ["M01"] });
  const updated = executeGenerateScript(state, { plan: plan("方案 A 修订"), material_ids: ["M01"] });

  assert.notEqual(original.plan_fingerprint, updated.plan_fingerprint);
  assert.equal(state.scripts.length, 2);
  assert.equal(state.scripts[0].valid, false);
  assert.equal(state.scripts[1].valid, true);
  assert.equal(state.current_plan_fingerprint, updated.plan_fingerprint);
});

test("injected generation failure does not create a successful script", async () => {
  const { executeGenerateScript } = await scriptModule;
  const { ToolError } = await errorsModule;
  const state = await makeState();

  assert.throws(
    () => executeGenerateScript(state, { plan: plan(), material_ids: ["M01"] }, {
      generate_script: { message: "injected script failure" },
    }),
    ToolError,
  );
  assert.equal(state.scripts.length, 0);
});
