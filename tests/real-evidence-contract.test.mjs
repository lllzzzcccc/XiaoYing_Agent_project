import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const validatorModule = import("../scripts/lib/real-evidence.mjs");

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "real-evidence-contract-"));
  const scenarios = [];
  for (const [id, failed] of [["path-a", false], ["path-b", true]]) {
    const input = path.join(directory, `${id}-input.json`);
    const output = path.join(directory, `${id}-output.json`);
    const trace = path.join(directory, `${id}-trace.jsonl`);
    await writeFile(input, "{}");
    await writeFile(output, JSON.stringify({ mode: "real", status: failed ? "incomplete" : "completed" }));
    const events = [
      { type: "tool_start", tool_name: "search_materials" },
      {
        type: "tool_end",
        tool_name: failed ? "estimate_cost" : "search_materials",
        error: failed ? { code: "TOOL_FAILED" } : null,
        next_action: failed ? "end" : "estimate_cost",
        decision_note: failed ? "工具失败，停止" : "根据素材继续估算",
      },
    ];
    await writeFile(trace, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    scenarios.push({ id, input, output, trace, actual_status: failed ? "incomplete" : "completed" });
  }
  const manifestPath = path.join(directory, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ mode: "real", scenarios }));
  return { directory, manifestPath, scenarios };
}

test("validator accepts two real paths with different observations and public decisions", async () => {
  const { validateRealEvidenceManifest } = await validatorModule;
  const { manifestPath } = await fixture();
  const result = await validateRealEvidenceManifest(manifestPath);

  assert.equal(result.scenarioCount, 2);
  assert.equal(new Set(result.signatures).size, 2);
});

test("validator rejects mock substitution and incomplete trace evidence", async () => {
  const { validateRealEvidenceManifest } = await validatorModule;
  const { directory, manifestPath, scenarios } = await fixture();
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.mode = "mock";
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(validateRealEvidenceManifest(manifestPath), /real/);

  manifest.mode = "real";
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(scenarios[0].trace, `${JSON.stringify({ type: "tool_end", tool_name: "search_materials" })}\n`);
  await assert.rejects(validateRealEvidenceManifest(manifestPath), /decision|next_action|工具|证据/);
});
