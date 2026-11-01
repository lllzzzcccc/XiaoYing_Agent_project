import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyEvidenceJson, copyEvidenceJsonl } from "./lib/evidence.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function normalizeDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await normalizeDirectory(target);
    else if (entry.name.endsWith(".jsonl")) await copyEvidenceJsonl(target, target, projectRoot);
    else if (entry.name.endsWith(".json")) await copyEvidenceJson(target, target, projectRoot);
  }
}

await normalizeDirectory(path.join(projectRoot, "examples"));
console.log("Normalized evidence paths in examples/.");
