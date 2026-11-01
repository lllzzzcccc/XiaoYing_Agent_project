import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRealEvidenceManifest } from "./lib/real-evidence.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(projectRoot, "examples/real/manifest.json");
const result = await validateRealEvidenceManifest(manifestPath);
console.log(`Validated ${result.scenarioCount} real model paths with distinct observations.`);
