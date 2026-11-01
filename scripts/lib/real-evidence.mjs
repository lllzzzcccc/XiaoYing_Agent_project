import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function resolveEvidence(manifestDir, value, field) {
  if (!value) throw new Error(`真实证据缺少 ${field}`);
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

export async function validateRealEvidenceManifest(manifestPath) {
  const manifest = await readJson(manifestPath);
  if (manifest.mode !== "real") throw new Error("真实证据必须标记 mode=real，禁止 Mock 替代");
  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length < 2) {
    throw new Error("真实证据至少需要两条执行路径");
  }

  const manifestDir = path.dirname(manifestPath);
  const signatures = [];
  for (const scenario of manifest.scenarios) {
    const input = resolveEvidence(manifestDir, scenario.input, "input");
    const outputPath = resolveEvidence(manifestDir, scenario.output, "output");
    const tracePath = resolveEvidence(manifestDir, scenario.trace, "trace");
    await readJson(input);
    const output = await readJson(outputPath);
    if (output.mode !== "real") throw new Error(`${scenario.id} 的输出不是真实模式`);
    if (output.status !== scenario.actual_status) throw new Error(`${scenario.id} 的输出状态与 manifest 不一致`);

    const rawTrace = await readFile(tracePath, "utf8");
    if (rawTrace.includes('"thinking"')) throw new Error(`${scenario.id} 的 Trace 包含思维内容`);
    const events = rawTrace.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    if (!events.some((event) => event.type === "tool_start") ||
        !events.some((event) => event.type === "tool_end")) {
      throw new Error(`${scenario.id} 缺少完整工具循环证据`);
    }
    const toolEnds = events.filter((event) => event.type === "tool_end");
    for (const event of toolEnds) {
      if (typeof event.next_action !== "string" || !event.next_action) {
        throw new Error(`${scenario.id} 缺少工具后的 next_action`);
      }
      if (typeof event.decision_note !== "string" || !event.decision_note.trim()) {
        throw new Error(`${scenario.id} 缺少公开 decision_note`);
      }
    }
    signatures.push(toolEnds.map((event) => `${event.tool_name}:${event.error ? "error" : "ok"}`).join("|"));
  }

  if (new Set(signatures).size < 2) {
    throw new Error("两条真实路径的工具观察没有形成可区分变化");
  }
  return { scenarioCount: manifest.scenarios.length, signatures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error("用法：node scripts/verify-real-evidence.mjs <manifest-path>");
  const result = await validateRealEvidenceManifest(manifestPath);
  console.log(`Validated ${result.scenarioCount} real model paths with distinct observations.`);
}
