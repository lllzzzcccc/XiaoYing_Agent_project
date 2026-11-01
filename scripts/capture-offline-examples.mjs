import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const cliPath = path.join(projectRoot, "dist/src/cli.js");
const examplesRoot = path.join(projectRoot, "examples");
const runtimeRoot = path.join(projectRoot, ".runtime/example-runs");

const scenarios = [
  {
    id: "normal",
    request: { request_id: "example-normal", theme: "春季新品", budget: 10, deadline: "2027-12-31T23:59:59Z" },
  },
  {
    id: "missing-budget",
    request: { request_id: "example-missing-budget", theme: "春季新品", deadline: "2027-12-31T23:59:59Z" },
  },
  {
    id: "save-failure",
    request: { request_id: "example-save-failure", theme: "春季新品", budget: 10, deadline: "2027-12-31T23:59:59Z" },
    faults: { save_plan: { message: "注入的方案保存失败" } },
  },
  {
    id: "no-material",
    request: { request_id: "example-no-material", theme: "完全不存在的内容", budget: 10, deadline: "2027-12-31T23:59:59Z" },
  },
  {
    id: "execution-limit",
    request: { request_id: "example-execution-limit", theme: "春季新品", budget: 10, deadline: "2027-12-31T23:59:59Z" },
    maxToolCalls: "1",
  },
  {
    id: "dual-infeasible",
    request: { request_id: "example-dual-infeasible", theme: "春季新品", budget: 5, deadline: "2020-01-01T00:00:00Z" },
  },
];

function runCli(input, runtimeDir, options = {}) {
  const args = [cliPath, "--input", input, "--offline", "--runtime-dir", runtimeDir];
  if (options.faults) args.push("--faults", options.faults);
  const env = { ...process.env };
  if (options.maxToolCalls) env.CONTENT_PLANNER_MAX_TOOL_CALLS = options.maxToolCalls;
  else delete env.CONTENT_PLANNER_MAX_TOOL_CALLS;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!stdout) return reject(new Error(`CLI produced no output: ${stderr}`));
      resolve({ code, result: JSON.parse(stdout), stderr });
    });
  });
}

async function copyIfPresent(source, target) {
  try {
    await copyFile(source, target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

await mkdir(examplesRoot, { recursive: true });
const manifest = { schema_version: 1, mode: "mock", generated_at: new Date().toISOString(), scenarios: [], duplicates: [] };

for (const scenario of scenarios) {
  const input = path.join(examplesRoot, "inputs", `${scenario.id}.json`);
  const output = path.join(examplesRoot, "outputs", `${scenario.id}.json`);
  const trace = path.join(examplesRoot, "traces", `${scenario.id}.jsonl`);
  const plan = path.join(examplesRoot, "plans", `${scenario.id}.json`);
  const runtimeDir = path.join(runtimeRoot, scenario.id);
  await Promise.all([
    mkdir(path.dirname(input), { recursive: true }),
    mkdir(path.dirname(output), { recursive: true }),
    mkdir(path.dirname(trace), { recursive: true }),
    mkdir(path.dirname(plan), { recursive: true }),
  ]);
  await writeFile(input, `${JSON.stringify(scenario.request, null, 2)}\n`);
  let faultsPath;
  if (scenario.faults) {
    faultsPath = path.join(examplesRoot, "faults", `${scenario.id}.json`);
    await mkdir(path.dirname(faultsPath), { recursive: true });
    await writeFile(faultsPath, `${JSON.stringify(scenario.faults, null, 2)}\n`);
  }
  await rm(runtimeDir, { recursive: true, force: true });
  const run = await runCli(input, runtimeDir, { faults: faultsPath, maxToolCalls: scenario.maxToolCalls });
  await writeFile(output, `${JSON.stringify(run.result, null, 2)}\n`);

  const requestDir = path.join(runtimeDir, "requests");
  const requestFiles = await readdir(requestDir).catch(() => []);
  const state = requestFiles[0]
    ? JSON.parse(await readFile(path.join(requestDir, requestFiles[0]), "utf8"))
    : null;
  const hasTrace = state ? await copyIfPresent(state.trace_path, trace) : false;
  const hasPlan = run.result.saved_plan
    ? await copyIfPresent(run.result.saved_plan.path, plan)
    : false;
  manifest.scenarios.push({
    id: scenario.id,
    mode: "mock",
    input: path.relative(projectRoot, input),
    output: path.relative(projectRoot, output),
    trace: hasTrace ? path.relative(projectRoot, trace) : null,
    plan: hasPlan ? path.relative(projectRoot, plan) : null,
    exit_code: run.code,
    actual_status: run.result.status,
  });

  if (scenario.id === "normal") {
    const duplicateOutput = path.join(examplesRoot, "outputs", "normal-duplicate.json");
    const duplicate = await runCli(input, runtimeDir);
    assert.equal(duplicate.result.duplicate, true);
    await writeFile(duplicateOutput, `${JSON.stringify(duplicate.result, null, 2)}\n`);
    manifest.duplicates.push({
      of: "normal",
      output: path.relative(projectRoot, duplicateOutput),
      actual_status: duplicate.result.status,
      duplicate: duplicate.result.duplicate,
    });
  }
}

await writeFile(path.join(examplesRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Captured ${manifest.scenarios.length} offline scenarios and ${manifest.duplicates.length} duplicate result.`);
