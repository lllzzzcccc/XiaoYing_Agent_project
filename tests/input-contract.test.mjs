import assert from "node:assert/strict";
import test from "node:test";

const requestModule = import("../dist/src/domain/request.js");
const resultModule = import("../dist/src/domain/result.js");

const validRequest = {
  request_id: "req-002",
  theme: "春季内容活动",
  budget: 10,
  deadline: "2026-12-31T23:59:59+08:00",
};

test("valid JSON preserves the original input including unknown fields", async () => {
  const { parsePlanningRequest } = await requestModule;
  const originalInput = { ...validRequest, review_note: "保留但不参与业务" };
  const parsed = parsePlanningRequest(JSON.stringify(originalInput));

  assert.deepEqual(parsed.originalInput, originalInput);
  assert.deepEqual(parsed.request, validRequest);
});

test("missing budget and deadline produce field-specific INPUT_MISSING reasons", async () => {
  const { parsePlanningRequest, InputValidationError } = await requestModule;

  for (const field of ["budget", "deadline"]) {
    const input = { ...validRequest };
    delete input[field];
    assert.throws(
      () => parsePlanningRequest(JSON.stringify(input)),
      (error) => {
        assert.ok(error instanceof InputValidationError);
        assert.equal(error.reasons[0].code, "INPUT_MISSING");
        assert.equal(error.reasons[0].field, field);
        return true;
      },
    );
  }
});

test("missing request_id, blank theme, negative budget, and invalid deadlines are rejected", async () => {
  const { parsePlanningRequest, InputValidationError } = await requestModule;
  const cases = [
    [{ ...validRequest, request_id: " " }, "request_id"],
    [{ ...validRequest, theme: "  " }, "theme"],
    [{ ...validRequest, budget: -1 }, "budget"],
    [{ ...validRequest, budget: Number.NaN }, "budget"],
    [{ ...validRequest, deadline: "2026-12-31" }, "deadline"],
    [{ ...validRequest, deadline: "2026-02-30T10:00:00Z" }, "deadline"],
  ];

  for (const [input, field] of cases) {
    assert.throws(
      () => parsePlanningRequest(JSON.stringify(input)),
      (error) => {
        assert.ok(error instanceof InputValidationError);
        assert.ok(error.reasons.some((reason) => reason.field === field));
        return true;
      },
    );
  }

  const withoutRequestId = { ...validRequest };
  delete withoutRequestId.request_id;
  assert.throws(() => parsePlanningRequest(JSON.stringify(withoutRequestId)), InputValidationError);
  assert.throws(() => parsePlanningRequest("{"), InputValidationError);
});

test("initial, duplicate, and conflict result envelopes preserve their status semantics", async () => {
  const { createInitialResult, createRequestConflictResult, markDuplicateResult } = await resultModule;
  const initial = createInitialResult("req-002", "mock");

  assert.equal(initial.schema_version, 1);
  assert.equal(initial.request_id, "req-002");
  assert.equal(initial.duplicate, false);
  assert.equal(initial.status, "incomplete");
  assert.equal(initial.mode, "mock");
  assert.equal(initial.task_plan, null);
  assert.equal(initial.saved_plan, null);
  assert.deepEqual(initial.steps, []);
  assert.deepEqual(initial.reasons, []);

  const duplicate = markDuplicateResult(initial);
  assert.equal(duplicate.duplicate, true);
  assert.equal(initial.duplicate, false);
  assert.notEqual(duplicate, initial);

  const conflict = createRequestConflictResult("req-002", "real");
  assert.equal(conflict.status, "incomplete");
  assert.equal(conflict.duplicate, false);
  assert.equal(conflict.reasons[0].code, "REQUEST_CONFLICT");
  assert.equal(conflict.saved_plan, null);
});
