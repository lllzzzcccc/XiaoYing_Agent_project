import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const cliPath = new URL("../dist/src/cli.js", import.meta.url).pathname;

async function runCli(input, runtimeDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "--input", input, "--offline", "--runtime-dir", runtimeDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, result: JSON.parse(stdout) }));
  });
}

test("independent processes return the original result without new side effects", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "content-planner-repeat-"));
  const input = path.join(directory, "input.json");
  const runtimeDir = path.join(directory, "runtime");
  await writeFile(input, JSON.stringify({
    request_id: "req-repeat",
    theme: "春季新品",
    budget: 10,
    deadline: "2027-12-31T23:59:59Z",
  }));

  const first = await runCli(input, runtimeDir);
  assert.equal(first.code, 0, first.stderr);
  const savedPath = first.result.saved_plan.path;
  const requestFiles = await readdir(path.join(runtimeDir, "requests"));
  assert.equal(requestFiles.length, 1);
  const actualRequestPath = path.join(runtimeDir, "requests", requestFiles[0]);
  const persistedBefore = await readFile(actualRequestPath, "utf8");
  const savedBefore = await readFile(savedPath, "utf8");

  const second = await runCli(input, runtimeDir);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(second.result.duplicate, true);
  assert.equal(second.result.saved_plan.path, savedPath);
  assert.deepEqual(second.result.steps, first.result.steps);
  assert.deepEqual(second.result.current_cost, first.result.current_cost);
  assert.equal(await readFile(actualRequestPath, "utf8"), persistedBefore);
  assert.equal(await readFile(savedPath, "utf8"), savedBefore);

  const persisted = JSON.parse(persistedBefore);
  assert.equal(persisted.original_result.duplicate, false);
  assert.equal((await readdir(path.dirname(savedPath))).length, 1);
});

test("same id with different input conflicts across processes without overwriting original data", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "content-planner-conflict-"));
  const runtimeDir = path.join(directory, "runtime");
  const firstInput = path.join(directory, "first.json");
  const secondInput = path.join(directory, "second.json");
  await writeFile(firstInput, JSON.stringify({
    request_id: "req-conflict",
    theme: "春季新品",
    budget: 10,
    deadline: "2027-12-31T23:59:59Z",
  }));
  const first = await runCli(firstInput, runtimeDir);
  assert.equal(first.code, 0, first.stderr);
  const [requestFile] = await readdir(path.join(runtimeDir, "requests"));
  const requestPath = path.join(runtimeDir, "requests", requestFile);
  const before = await readFile(requestPath, "utf8");

  await writeFile(secondInput, JSON.stringify({
    request_id: "req-conflict",
    theme: "不同主题",
    budget: 10,
    deadline: "2027-12-31T23:59:59Z",
  }));
  const conflict = await runCli(secondInput, runtimeDir);
  assert.equal(conflict.code, 2);
  assert.equal(conflict.result.status, "incomplete");
  assert.equal(conflict.result.duplicate, false);
  assert.ok(conflict.result.reasons.some((reason) => reason.code === "REQUEST_CONFLICT"));
  assert.equal(conflict.result.saved_plan, null);
  assert.equal(await readFile(requestPath, "utf8"), before);
  assert.equal(JSON.parse(await readFile(first.result.saved_plan.path, "utf8")).original_input.theme, "春季新品");
});
