import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const estimateModule = import("../dist/src/tools/estimates.js");
const errorsModule = import("../dist/src/tools/errors.js");
const stateModule = import("../dist/src/domain/run-state.js");

const costItems = [
  { cost_item_id: "base", unit_cost: 12, duration_seconds: 120 },
  { cost_item_id: "lite", unit_cost: 8, duration_seconds: 60 },
  { cost_item_id: "slow", unit_cost: 5, duration_seconds: 600 },
];

function plan(id, costItemId) {
  return {
    plan_id: id,
    title: id,
    steps: [{ step_id: "s1", title: "执行", cost_item_id: costItemId, depends_on: [], quantity: 1 }],
  };
}

async function makeState() {
  const { createRunState } = await stateModule;
  const request = { request_id: "req-estimate", theme: "估算", budget: 10, deadline: "2026-11-02T10:03:00Z" };
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

test("infeasible estimates are successful observations with complete cost and time facts", async () => {
  const { executeEstimateCost } = await estimateModule;
  const state = await makeState();
  const estimate = executeEstimateCost(state, costItems, { plan: plan("initial", "base") });

  assert.equal(estimate.total_cost, 12);
  assert.equal(estimate.total_duration_seconds, 120);
  assert.equal(estimate.budget_feasible, false);
  assert.equal(estimate.time_feasible, true);
  assert.equal(estimate.feasible, false);
  assert.equal(estimate.budget_gap, 2);
  assert.equal(state.estimates.length, 1);
});

test("alternative estimates retain history while the current fingerprint selects the latest", async () => {
  const { executeEstimateCost, currentEstimate } = await estimateModule;
  const state = await makeState();
  const initial = executeEstimateCost(state, costItems, { plan: plan("initial", "base") });
  const alternative = executeEstimateCost(state, costItems, { plan: plan("alternative", "lite") });

  assert.equal(state.estimates.length, 2);
  assert.equal(state.estimates[0].estimate_id, initial.estimate_id);
  assert.equal(currentEstimate(state).estimate_id, alternative.estimate_id);
  assert.equal(currentEstimate(state).total_cost, 8);
  assert.equal(currentEstimate(state).feasible, true);
  assert.notEqual(currentEstimate(state).total_cost, initial.total_cost + alternative.total_cost);
});

test("changed plan content invalidates its old estimate without deleting it", async () => {
  const { executeEstimateCost } = await estimateModule;
  const state = await makeState();
  executeEstimateCost(state, costItems, { plan: plan("same", "base") });
  executeEstimateCost(state, costItems, { plan: plan("same", "lite") });

  assert.equal(state.estimates.length, 2);
  assert.equal(state.estimates[0].valid, false);
  assert.equal(state.estimates[1].valid, true);
});

test("invalid plans and injected failures do not append successful estimates", async () => {
  const { executeEstimateCost } = await estimateModule;
  const { ToolError } = await errorsModule;
  const state = await makeState();

  assert.throws(() => executeEstimateCost(state, costItems, { plan: plan("bad", "unknown") }), ToolError);
  assert.throws(
    () => executeEstimateCost(state, costItems, { plan: plan("bad", "base") }, {
      estimate_cost: { message: "injected estimate failure" },
    }),
    ToolError,
  );
  assert.equal(state.estimates.length, 0);
});

test("packaged cost catalog has unique ids and nonnegative cost and duration", async () => {
  const catalog = JSON.parse(await readFile(new URL("../data/cost-items.json", import.meta.url), "utf8"));
  assert.ok(catalog.length >= 3);
  assert.equal(new Set(catalog.map((item) => item.cost_item_id)).size, catalog.length);
  for (const item of catalog) {
    assert.ok(item.unit_cost >= 0);
    assert.ok(Number.isInteger(item.duration_seconds));
    assert.ok(item.duration_seconds >= 0);
  }
});
