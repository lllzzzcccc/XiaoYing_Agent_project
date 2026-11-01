import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const examplesRoot = path.join(projectRoot, "examples");

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(target));
    else files.push(target);
  }
  return files;
}

test("evidence contains no local absolute paths and uses portable runtime paths", async () => {
  const files = await filesUnder(examplesRoot);
  const forbidden = [projectRoot, "/Users/", "/home/", "/var/folders/", "file://"];
  const violations = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const marker of forbidden) {
      if (content.includes(marker)) violations.push(`${path.relative(projectRoot, file)} contains ${marker}`);
    }
  }
  assert.deepEqual(violations, []);

  const normal = JSON.parse(await readFile(path.join(examplesRoot, "outputs/normal.json"), "utf8"));
  const real = JSON.parse(await readFile(path.join(examplesRoot, "real/outputs/replan.json"), "utf8"));
  for (const result of [normal, real]) {
    assert.ok(result.saved_plan.path.startsWith(".runtime/"));
    assert.ok(result.trace.path.startsWith(".runtime/"));
  }
  assert.equal(normal.status, "completed");
  assert.equal(real.status, "completed");
});
