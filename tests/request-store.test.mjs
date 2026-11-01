import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const storeModule = import("../dist/src/store/request-store.js");
const fileModule = import("../dist/src/store/json-file.js");
const resultModule = import("../dist/src/domain/result.js");

async function makeRuntimeDir() {
  return mkdtemp(path.join(tmpdir(), "content-planner-store-"));
}

function input(overrides = {}) {
  return {
    request: {
      request_id: "req/../004",
      theme: "本地存储",
      budget: 10,
      deadline: "2026-12-31T23:59:59Z",
      ...overrides,
    },
    originalInput: {
      request_id: "req/../004",
      theme: "本地存储",
      budget: 10,
      deadline: "2026-12-31T23:59:59Z",
      ...overrides,
    },
  };
}

test("a new request persists complete state without exposing the raw id in paths", async () => {
  const { RequestStore } = await storeModule;
  const store = new RequestStore(await makeRuntimeDir());
  const opened = await store.beginRequest({ ...input(), mode: "mock", startedAt: "2026-11-02T10:00:00Z" });

  assert.equal(opened.kind, "new");
  assert.equal(opened.record.status, "running");
  assert.equal(opened.record.original_result, null);
  assert.equal(opened.record.tool_call_count, 0);
  assert.equal(opened.record.max_tool_calls, 12);
  assert.ok(!store.requestPath("req/../004").includes("req/../004"));

  const loaded = await store.load("req/../004");
  assert.equal(loaded.request_id, "req/../004");
  assert.deepEqual(loaded.steps, []);
});

test("final results stay original while duplicate responses are clones marked duplicate", async () => {
  const { RequestStore } = await storeModule;
  const { createInitialResult } = await resultModule;
  const store = new RequestStore(await makeRuntimeDir());
  const opened = await store.beginRequest({ ...input(), mode: "mock" });
  const result = createInitialResult("req/../004", "mock");
  result.status = "completed";
  await store.finalize(opened.record, result);

  const duplicate = await store.beginRequest({ ...input(), mode: "mock" });
  assert.equal(duplicate.kind, "duplicate");
  assert.equal(duplicate.result.duplicate, true);
  assert.equal(duplicate.result.status, "completed");

  const persisted = await store.load("req/../004");
  assert.equal(persisted.original_result.duplicate, false);
  assert.equal(persisted.original_result.status, "completed");
});

test("same id with different input conflicts without modifying the original record", async () => {
  const { RequestStore } = await storeModule;
  const { createInitialResult } = await resultModule;
  const store = new RequestStore(await makeRuntimeDir());
  const opened = await store.beginRequest({ ...input(), mode: "mock" });
  await store.finalize(opened.record, createInitialResult("req/../004", "mock"));
  const before = await readFile(store.requestPath("req/../004"), "utf8");

  const conflict = await store.beginRequest({ ...input({ theme: "不同输入" }), mode: "mock" });
  assert.equal(conflict.kind, "conflict");
  assert.equal(conflict.result.reasons[0].code, "REQUEST_CONFLICT");
  assert.equal(conflict.result.duplicate, false);
  assert.equal(await readFile(store.requestPath("req/../004"), "utf8"), before);
});

test("an unfinished same request becomes an interrupted original result", async () => {
  const { RequestStore } = await storeModule;
  const store = new RequestStore(await makeRuntimeDir());
  await store.beginRequest({ ...input(), mode: "real" });

  const recovered = await store.beginRequest({ ...input(), mode: "real" });
  assert.equal(recovered.kind, "duplicate");
  assert.equal(recovered.result.status, "incomplete");
  assert.equal(recovered.result.duplicate, true);
  assert.equal(recovered.result.reasons[0].code, "RUN_INTERRUPTED");
});

test("atomic write failure preserves the last complete JSON document", async () => {
  const { writeJsonAtomic, readJsonFile } = await fileModule;
  const runtimeDir = await makeRuntimeDir();
  const filePath = path.join(runtimeDir, "record.json");
  await writeJsonAtomic(filePath, { version: 1 });

  await assert.rejects(
    writeJsonAtomic(filePath, { version: 2 }, {
      rename: async () => {
        throw new Error("injected rename failure");
      },
    }),
  );
  assert.deepEqual(await readJsonFile(filePath), { version: 1 });
});
