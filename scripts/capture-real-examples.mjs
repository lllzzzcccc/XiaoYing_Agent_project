import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRealEvidenceManifest } from "./lib/real-evidence.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const cliPath = path.join(projectRoot, "dist/src/cli.js");
const outputRoot = path.join(projectRoot, "examples/real");
const runtimeRoot = path.join(projectRoot, ".runtime/real-example-runs");
const provider = process.env.CONTENT_PLANNER_PROVIDER;
const model = process.env.CONTENT_PLANNER_MODEL;
if (!provider || !model) {
  throw new Error("真实证据采集需要 CONTENT_PLANNER_PROVIDER 和 CONTENT_PLANNER_MODEL；不得用 Mock 替代");
}

const scenarios = [
  {
    id: "replan",
    request: { request_id: "real-replan", theme: "春季新品", budget: 10, deadline: "2027-12-31T23:59:59Z" },
  },
  {
    id: "tool-failure",
    request: { request_id: "real-tool-failure", theme: "春季新品", budget: 10, deadline: "2027-12-31T23:59:59Z" },
    faults: { save_plan: { message: "真实路径中的保存失败注入" } },
  },
];

function runCli(input, runtimeDir, faults) {
  const args = [cliPath, "--input", input, "--runtime-dir", runtimeDir];
  if (faults) args.push("--faults", faults);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!stdout) return reject(new Error(`真实 CLI 未返回 JSON：${stderr}`));
      resolve({ code, result: JSON.parse(stdout) });
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

const manifest = {
  schema_version: 1,
  mode: "real",
  provider,
  model,
  generated_at: new Date().toISOString(),
  scenarios: [],
};

for (const scenario of scenarios) {
  const input = path.join(outputRoot, "inputs", `${scenario.id}.json`);
  const output = path.join(outputRoot, "outputs", `${scenario.id}.json`);
  const trace = path.join(outputRoot, "traces", `${scenario.id}.jsonl`);
  const plan = path.join(outputRoot, "plans", `${scenario.id}.json`);
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
    faultsPath = path.join(outputRoot, "faults", `${scenario.id}.json`);
    await mkdir(path.dirname(faultsPath), { recursive: true });
    await writeFile(faultsPath, `${JSON.stringify(scenario.faults, null, 2)}\n`);
  }
  await rm(runtimeDir, { recursive: true, force: true });
  const run = await runCli(input, runtimeDir, faultsPath);
  await writeFile(output, `${JSON.stringify(run.result, null, 2)}\n`);

  const requestDir = path.join(runtimeDir, "requests");
  const [requestFile] = await readdir(requestDir);
  const state = JSON.parse(await readFile(path.join(requestDir, requestFile), "utf8"));
  const hasTrace = await copyIfPresent(state.trace_path, trace);
  const hasPlan = run.result.saved_plan ? await copyIfPresent(run.result.saved_plan.path, plan) : false;
  manifest.scenarios.push({
    id: scenario.id,
    input: path.relative(projectRoot, input),
    output: path.relative(projectRoot, output),
    trace: hasTrace ? path.relative(projectRoot, trace) : null,
    plan: hasPlan ? path.relative(projectRoot, plan) : null,
    exit_code: run.code,
    actual_status: run.result.status,
  });
}

const manifestPath = path.join(outputRoot, "manifest.json");
await mkdir(path.dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await validateRealEvidenceManifest(manifestPath);
console.log(`Captured and validated ${manifest.scenarios.length} real model paths.`);
