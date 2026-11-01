import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("offline example manifest contains actual inputs, outputs, traces, and required scenarios", async () => {
  const manifest = await readJson("../examples/manifest.json");
  assert.ok(manifest.scenarios.length >= 3);
  const ids = new Set(manifest.scenarios.map((scenario) => scenario.id));
  for (const required of ["normal", "missing-budget", "save-failure", "no-material", "execution-limit", "dual-infeasible"]) {
    assert.ok(ids.has(required), `missing scenario ${required}`);
  }

  for (const scenario of manifest.scenarios) {
    assert.equal(scenario.mode, "mock");
    await stat(new URL(`../${scenario.input}`, import.meta.url));
    await stat(new URL(`../${scenario.output}`, import.meta.url));
    const output = await readJson(`../${scenario.output}`);
    assert.equal(output.mode, "mock");
    assert.equal(output.status, scenario.actual_status);
    if (scenario.trace) await stat(new URL(`../${scenario.trace}`, import.meta.url));
    if (scenario.plan) await stat(new URL(`../${scenario.plan}`, import.meta.url));
  }

  const normalTrace = await readFile(new URL(`../${manifest.scenarios.find((item) => item.id === "normal").trace}`, import.meta.url), "utf8");
  assert.ok(normalTrace.includes('"plan_id":"initial"'));
  assert.ok(normalTrace.includes('"plan_id":"alternative"'));
  assert.ok(normalTrace.includes("next_action"));
  assert.ok(normalTrace.includes("decision_note"));
  const failedTrace = await readFile(new URL(`../${manifest.scenarios.find((item) => item.id === "save-failure").trace}`, import.meta.url), "utf8");
  assert.ok(failedTrace.includes("INJECTED_FAILURE"));
});
