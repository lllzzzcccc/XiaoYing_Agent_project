import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const stepsModule = import("../dist/src/domain/steps.js");
const stateModule = import("../dist/src/domain/run-state.js");
const traceModule = import("../dist/src/trace/trace.js");

async function makeState() {
  const { createRunState } = await stateModule;
  const request = { request_id: "req-trace", theme: "状态", budget: 10, deadline: "2026-12-31T23:59:59Z" };
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

test("run steps enforce transitions and retries append attempts without erasing failure", async () => {
  const { startRunStep, finishRunStep, transitionRunStep } = await stepsModule;
  const state = await makeState();
  const first = startRunStep(state, {
    toolCallId: "call-1",
    toolName: "search_materials",
    args: { query: "春季" },
  });
  assert.equal(first.status, "running");
  assert.equal(first.attempt, 1);
  assert.equal(state.tool_call_count, 1);
  assert.throws(() => transitionRunStep(first, "pending"));

  finishRunStep(state, first, {
    status: "failed",
    error: { code: "TOOL_FAILURE", message: "failed", retryable: true },
  });
  const retry = startRunStep(state, {
    toolCallId: "call-2",
    toolName: "search_materials",
    args: { query: "新品" },
  });
  finishRunStep(state, retry, { status: "succeeded", resultSummary: { count: 1 } });

  assert.equal(retry.attempt, 2);
  assert.equal(state.steps[0].status, "failed");
  assert.equal(state.steps[1].status, "succeeded");
  assert.equal(state.steps[0].error.code, "TOOL_FAILURE");
  assert.equal(state.tool_call_count, 2);
});

test("partial success and invalidation preserve historical step results", async () => {
  const { startRunStep, finishRunStep, invalidatePlanSteps } = await stepsModule;
  const state = await makeState();
  const success = startRunStep(state, { toolCallId: "call-1", toolName: "generate_script", args: {}, planId: "p1", planFingerprint: "fp1" });
  finishRunStep(state, success, { status: "succeeded", resultSummary: { script_id: "s1" } });
  const failed = startRunStep(state, { toolCallId: "call-2", toolName: "save_plan", args: {}, planId: "p1", planFingerprint: "fp1" });
  finishRunStep(state, failed, {
    status: "failed",
    error: { code: "SAVE_FAILED", message: "save failed", retryable: true },
  });

  assert.equal(state.steps.filter((step) => step.status === "succeeded").length, 1);
  assert.equal(state.steps.filter((step) => step.status === "failed").length, 1);
  invalidatePlanSteps(state, "p1", "fp1");
  assert.equal(success.status, "invalidated");
  assert.equal(success.result_summary.script_id, "s1");
  assert.equal(failed.status, "failed");
});

test("trace records actual tool data and subsequent public decisions without thinking content", async () => {
  const { TraceWriter } = await traceModule;
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "content-planner-trace-"));
  const tracePath = path.join(runtimeDir, "trace.jsonl");
  const writer = await TraceWriter.create({ path: tracePath, requestId: "req-trace", mode: "mock" });

  await writer.record({
    type: "tool_end",
    step_id: "step-1",
    tool_name: "estimate_cost",
    args: { plan_id: "p1" },
    result_summary: { feasible: false, total_cost: 12 },
    plan_id: "p1",
    plan_fingerprint: "fp1",
    thinking: "hidden reasoning must not be persisted",
  });
  await writer.attachDecision("estimate_cost:alternative", "当前方案超预算，改估替代方案");

  const raw = await readFile(tracePath, "utf8");
  assert.ok(raw.includes("estimate_cost:alternative"));
  assert.ok(raw.includes("当前方案超预算"));
  assert.ok(!raw.includes("hidden reasoning"));
  assert.ok(!raw.includes("thinking"));

  const reloaded = await TraceWriter.create({ path: tracePath, requestId: "req-trace", mode: "mock" });
  await reloaded.record({ type: "run_end", result_summary: { status: "incomplete" } });
  assert.deepEqual(reloaded.events.map((event) => event.sequence), [1, 2]);
  assert.equal(reloaded.events[0].next_action, "estimate_cost:alternative");
  assert.equal(reloaded.events[1].decision_note, null);
});
