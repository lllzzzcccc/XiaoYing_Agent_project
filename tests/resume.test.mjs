import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const cliPath = new URL("../dist/src/cli.js", import.meta.url).pathname;

async function runCli(input, runtimeDir, { resume = false, faults } = {}) {
  const args = [cliPath, "--input", input, "--offline", "--runtime-dir", runtimeDir];
  if (resume) args.push("--resume");
  if (faults) args.push("--faults", faults);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, result: JSON.parse(stdout) }));
  });
}

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "content-planner-resume-"));
  const runtimeDir = path.join(directory, "runtime");
  const input = path.join(directory, "input.json");
  const faults = path.join(directory, "faults.json");
  const request = { request_id: "req-resume", theme: "春季新品", budget: 10, deadline: "2027-12-31T23:59:59Z" };
  await writeFile(input, JSON.stringify(request));
  await writeFile(faults, JSON.stringify({ save_plan: { message: "injected save failure" } }));
  return { directory, runtimeDir, input, faults, request };
}

test("resume reuses valid successes, retains failure history, and does not charge retries", async () => {
  const { runtimeDir, input, faults } = await setup();
  const failed = await runCli(input, runtimeDir, { faults });
  assert.equal(failed.code, 1);
  assert.equal(failed.result.status, "incomplete");
  const [requestFile] = await readdir(path.join(runtimeDir, "requests"));
  const statePath = path.join(runtimeDir, "requests", requestFile);
  const before = JSON.parse(await readFile(statePath, "utf8"));
  const traceBefore = await readFile(before.trace_path, "utf8");

  const resumed = await runCli(input, runtimeDir, { resume: true });
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(resumed.result.status, "completed");
  assert.equal(resumed.result.duplicate, false);
  assert.equal(resumed.result.current_cost.current.total_cost, 4);
  assert.ok(resumed.result.steps.some((step) => step.tool_name === "save_plan" && step.status === "failed"));
  assert.ok(resumed.result.steps.some((step) => step.tool_name === "save_plan" && step.status === "succeeded"));

  const after = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(after.started_at, before.started_at);
  assert.equal(after.material_searches.length, before.material_searches.length);
  assert.equal(after.scripts.length, before.scripts.length);
  assert.equal(after.estimates.length, before.estimates.length);
  assert.equal(after.result_history.length, 1);
  assert.equal(after.result_history[0].status, "incomplete");
  const traceAfter = await readFile(before.trace_path, "utf8");
  assert.ok(traceAfter.length > traceBefore.length);
  assert.ok(traceAfter.includes(traceBefore));
});

test("resume with different input conflicts without modifying the original result", async () => {
  const { directory, runtimeDir, input, faults, request } = await setup();
  await runCli(input, runtimeDir, { faults });
  const [requestFile] = await readdir(path.join(runtimeDir, "requests"));
  const statePath = path.join(runtimeDir, "requests", requestFile);
  const before = await readFile(statePath, "utf8");
  const changed = path.join(directory, "changed.json");
  await writeFile(changed, JSON.stringify({ ...request, theme: "不同主题" }));

  const conflict = await runCli(changed, runtimeDir, { resume: true });
  assert.equal(conflict.code, 2);
  assert.ok(conflict.result.reasons.some((reason) => reason.code === "REQUEST_CONFLICT"));
  assert.equal(await readFile(statePath, "utf8"), before);
});

test("resume without existing state or with a completed result has explicit behavior", async () => {
  const { runtimeDir, input } = await setup();
  const missing = await runCli(input, runtimeDir, { resume: true });
  assert.equal(missing.code, 2);
  assert.ok(missing.result.reasons.some((reason) => reason.code === "RESUME_UNSUPPORTED"));

  const completed = await runCli(input, runtimeDir);
  assert.equal(completed.code, 0);
  const duplicate = await runCli(input, runtimeDir, { resume: true });
  assert.equal(duplicate.code, 0);
  assert.equal(duplicate.result.duplicate, true);
  assert.deepEqual(duplicate.result.steps, completed.result.steps);
});
