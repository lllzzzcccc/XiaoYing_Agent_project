import assert from "node:assert/strict";
import test from "node:test";

const fingerprintModule = import("../dist/src/domain/fingerprint.js");
const planningModule = import("../dist/src/domain/planning.js");

const costItems = [
  { cost_item_id: "research", unit_cost: 0.1, duration_seconds: 60 },
  { cost_item_id: "draft", unit_cost: 0.2, duration_seconds: 120 },
  { cost_item_id: "video", unit_cost: 12, duration_seconds: 600 },
];

function makePlan(overrides = {}) {
  return {
    plan_id: "plan-a",
    title: "候选方案",
    steps: [
      { step_id: "s1", title: "调研", cost_item_id: "research", depends_on: [], quantity: 1 },
      { step_id: "s2", title: "草稿", cost_item_id: "draft", depends_on: ["s1"], quantity: 1 },
    ],
    ...overrides,
  };
}

test("canonical fingerprints ignore object key order but preserve values and array order", async () => {
  const { fingerprintJson } = await fingerprintModule;
  assert.equal(fingerprintJson({ b: 2, a: 1 }), fingerprintJson({ a: 1, b: 2 }));
  assert.notEqual(fingerprintJson({ a: 1 }), fingerprintJson({ a: 2 }));
  assert.notEqual(fingerprintJson({ a: [1, 2] }), fingerprintJson({ a: [2, 1] }));
});

test("decimal cost and serial duration make the exact deadline feasible", async () => {
  const { evaluateCampaignPlan } = await planningModule;
  const result = evaluateCampaignPlan(makePlan(), costItems, {
    budget: 0.3,
    deadline: "2026-11-02T10:03:00Z",
    startedAt: "2026-11-02T10:00:00Z",
  });

  assert.equal(result.total_cost, 0.3);
  assert.equal(result.total_duration_seconds, 180);
  assert.equal(result.estimated_completion_at, "2026-11-02T10:03:00.000Z");
  assert.equal(result.budget_feasible, true);
  assert.equal(result.time_feasible, true);
  assert.equal(result.feasible, true);
  assert.equal(result.budget_gap, 0);
  assert.deepEqual(result.items.map((item) => item.subtotal_cost), [0.1, 0.2]);
});

test("budget and deadline failures coexist and quantity affects cost and duration", async () => {
  const { evaluateCampaignPlan } = await planningModule;
  const plan = makePlan({
    steps: [{ step_id: "s1", title: "制作", cost_item_id: "video", depends_on: [], quantity: 2 }],
  });
  const result = evaluateCampaignPlan(plan, costItems, {
    budget: 10,
    deadline: "2026-11-02T10:10:00Z",
    startedAt: "2026-11-02T10:00:00Z",
  });

  assert.equal(result.total_cost, 24);
  assert.equal(result.total_duration_seconds, 1200);
  assert.equal(result.budget_feasible, false);
  assert.equal(result.time_feasible, false);
  assert.equal(result.feasible, false);
  assert.equal(result.budget_gap, 14);
});

test("invalid plan dependencies, duplicates, and unknown cost items are rejected", async () => {
  const { evaluateCampaignPlan, PlanValidationError } = await planningModule;
  const context = { budget: 100, deadline: "2026-11-03T10:00:00Z", startedAt: "2026-11-02T10:00:00Z" };
  const invalidPlans = [
    makePlan({ steps: [makePlan().steps[0], makePlan().steps[0]] }),
    makePlan({ steps: [{ ...makePlan().steps[0], depends_on: ["s1"] }] }),
    makePlan({ steps: [{ ...makePlan().steps[0], depends_on: ["missing"] }] }),
    makePlan({ steps: [{ ...makePlan().steps[0], cost_item_id: "missing" }] }),
    makePlan({ steps: [] }),
  ];

  for (const plan of invalidPlans) {
    assert.throws(() => evaluateCampaignPlan(plan, costItems, context), PlanValidationError);
  }

  const cyclic = makePlan({
    steps: [
      { ...makePlan().steps[0], depends_on: ["s2"] },
      { ...makePlan().steps[1], depends_on: ["s1"] },
    ],
  });
  assert.throws(() => evaluateCampaignPlan(cyclic, costItems, context), PlanValidationError);
});

test("minimum budget gap uses the cheapest estimate and never becomes negative", async () => {
  const { minimumBudgetGap } = await planningModule;
  assert.equal(minimumBudgetGap([{ total_cost: 12 }, { total_cost: 8 }, { total_cost: 10 }], 10), 0);
  assert.equal(minimumBudgetGap([{ total_cost: 12 }, { total_cost: 14 }], 10), 2);
  assert.equal(minimumBudgetGap([], 10), null);
});
