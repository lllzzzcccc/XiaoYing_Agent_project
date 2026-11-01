import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const cliPath = new URL("../dist/src/cli.js", import.meta.url).pathname;

async function workspace() {
  return mkdtemp(path.join(tmpdir(), "content-planner-cli-"));
}

async function writeJson(directory, name, value) {
  const filePath = path.join(directory, name);
  await writeFile(filePath, JSON.stringify(value), "utf8");
  return filePath;
}

function validRequest(overrides = {}) {
  return {
    request_id: "req-cli",
    theme: "春季新品",
    budget: 10,
    deadline: "2027-12-31T23:59:59Z",
    ...overrides,
  };
}

async function runCli(args, env = {}) {
  const cleanEnv = { ...process.env };
  for (const name of [
    "CONTENT_PLANNER_PROVIDER",
    "CONTENT_PLANNER_MODEL",
    "CONTENT_PLANNER_MAX_TOOL_CALLS",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
  ]) delete cleanEnv[name];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: path.dirname(cliPath),
      env: { ...cleanEnv, ...env },
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

test("offline CLI completes without credentials and returns independently readable saved JSON", async () => {
  const directory = await workspace();
  const input = await writeJson(directory, "input.json", validRequest());
  const runtimeDir = path.join(directory, "runtime");
  const run = await runCli(["--input", input, "--offline", "--runtime-dir", runtimeDir]);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.result.status, "completed");
  assert.equal(run.result.mode, "mock");
  assert.equal(run.result.duplicate, false);
  const saved = JSON.parse(await readFile(run.result.saved_plan.path, "utf8"));
  assert.equal(saved.request_id, "req-cli");
  assert.equal(saved.original_input.theme, "春季新品");
});

test("missing budget returns INPUT_MISSING without invoking a model", async () => {
  const directory = await workspace();
  const inputValue = validRequest();
  delete inputValue.budget;
  const input = await writeJson(directory, "input.json", inputValue);
  const run = await runCli(["--input", input, "--offline", "--runtime-dir", path.join(directory, "runtime")]);

  assert.equal(run.code, 2);
  assert.equal(run.result.status, "incomplete");
  assert.equal(run.result.mode, "mock");
  assert.ok(run.result.reasons.some((reason) => reason.code === "INPUT_MISSING" && reason.field === "budget"));
});

test("real mode with missing provider configuration fails without silent mock fallback", async () => {
  const directory = await workspace();
  const input = await writeJson(directory, "input.json", validRequest());
  const run = await runCli(["--input", input, "--runtime-dir", path.join(directory, "runtime")]);

  assert.equal(run.code, 2);
  assert.equal(run.result.mode, "real");
  assert.equal(run.result.status, "incomplete");
  assert.ok(run.result.reasons.some((reason) => reason.code === "MODEL_UNAVAILABLE"));
  assert.ok(!run.result.saved_plan);
});

test("fault injection and execution limits produce incomplete offline CLI results", async () => {
  const saveDirectory = await workspace();
  const saveInput = await writeJson(saveDirectory, "input.json", validRequest());
  const faults = await writeJson(saveDirectory, "faults.json", {
    save_plan: { message: "injected save failure" },
  });
  const saveRun = await runCli([
    "--input", saveInput,
    "--offline",
    "--faults", faults,
    "--runtime-dir", path.join(saveDirectory, "runtime"),
  ]);
  assert.equal(saveRun.code, 1);
  assert.equal(saveRun.result.mode, "mock");
  assert.ok(saveRun.result.reasons.some((reason) => reason.code === "SAVE_FAILED"));

  const limitDirectory = await workspace();
  const limitInput = await writeJson(limitDirectory, "input.json", validRequest());
  const limitRun = await runCli(
    ["--input", limitInput, "--offline", "--runtime-dir", path.join(limitDirectory, "runtime")],
    { CONTENT_PLANNER_MAX_TOOL_CALLS: "1" },
  );
  assert.equal(limitRun.code, 1);
  assert.ok(limitRun.result.reasons.some((reason) => reason.code === "EXECUTION_LIMIT_REACHED"));
});

test("offline no-material path reports NO_MATERIALS", async () => {
  const directory = await workspace();
  const input = await writeJson(directory, "input.json", validRequest({ theme: "完全不存在的内容" }));
  const run = await runCli(["--input", input, "--offline", "--runtime-dir", path.join(directory, "runtime")]);

  assert.equal(run.code, 1);
  assert.equal(run.result.mode, "mock");
  assert.ok(run.result.reasons.some((reason) => reason.code === "NO_MATERIALS"));
});
