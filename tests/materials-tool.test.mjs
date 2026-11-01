import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const materialsModule = import("../dist/src/tools/materials.js");
const errorsModule = import("../dist/src/tools/errors.js");
const stateModule = import("../dist/src/domain/run-state.js");

const fixtures = [
  { material_id: "M01", title: "春季发布", summary: "新品发布", facts: ["支持字幕"], tags: ["春季", "新品"] },
  { material_id: "M02", title: "社群挑战", summary: "低预算活动", facts: ["包含线上任务"], tags: ["社群", "低成本"] },
  { material_id: "M03", title: "夏季户外", summary: "户外活动", facts: ["需要线下场地"], tags: ["夏季", "户外"] },
];

async function makeState() {
  const { createRunState } = await stateModule;
  const request = { request_id: "req-materials", theme: "春季新品", budget: 10, deadline: "2026-12-31T23:59:59Z" };
  return createRunState({
    request,
    originalInput: { ...request },
    inputFingerprint: "fingerprint",
    mode: "mock",
    startedAt: "2026-11-02T10:00:00Z",
    maxToolCalls: 12,
    tracePath: "/tmp/trace.jsonl",
  });
}

test("search returns traceable matches and honors the limit", async () => {
  const { searchMaterials } = await materialsModule;
  const result = searchMaterials(fixtures, { query: "春季", limit: 1 });

  assert.equal(result.count, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].material_id, "M01");
  assert.deepEqual(result.items[0].facts, ["支持字幕"]);
});

test("no matches is a successful empty observation and query history is retained", async () => {
  const { executeSearchMaterials } = await materialsModule;
  const state = await makeState();
  const first = executeSearchMaterials(state, fixtures, { query: "不存在" });
  const second = executeSearchMaterials(state, fixtures, { query: "社群" });

  assert.deepEqual(first.items, []);
  assert.equal(first.count, 0);
  assert.equal(second.count, 1);
  assert.deepEqual(state.material_searches.map((entry) => entry.query), ["不存在", "社群"]);
  assert.equal(state.material_searches[0].items.length, 0);
});

test("invalid parameters and injected failures use the tool error channel", async () => {
  const { executeSearchMaterials } = await materialsModule;
  const { ToolError } = await errorsModule;
  const state = await makeState();

  assert.throws(() => executeSearchMaterials(state, fixtures, { query: " " }), (error) => {
    assert.ok(error instanceof ToolError);
    assert.equal(error.code, "VALIDATION_ERROR");
    return true;
  });
  assert.throws(
    () => executeSearchMaterials(state, fixtures, { query: "春季" }, {
      search_materials: { message: "injected search failure" },
    }),
    (error) => {
      assert.ok(error instanceof ToolError);
      assert.equal(error.code, "INJECTED_FAILURE");
      assert.equal(error.injected, true);
      return true;
    },
  );
});

test("packaged synthetic materials contain unique ids and citable facts", async () => {
  const materials = JSON.parse(await readFile(new URL("../data/materials.json", import.meta.url), "utf8"));
  assert.ok(materials.length >= 3);
  assert.equal(new Set(materials.map((item) => item.material_id)).size, materials.length);
  for (const material of materials) {
    assert.ok(material.material_id);
    assert.ok(material.facts.length > 0);
  }
});
