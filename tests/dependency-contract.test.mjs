import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const pinnedDependencies = {
  "@earendil-works/pi-agent-core": "1.4.0",
  "@earendil-works/pi-ai": "1.4.0",
  "decimal.js": "10.6.0",
};

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8"));
}

test("package manifest declares the runtime and exact dependency versions", async () => {
  const manifest = await readJson("package.json");

  assert.equal(manifest.type, "module");
  assert.equal(manifest.engines.node, ">=22.19.0");
  assert.ok(manifest.scripts.build);
  assert.ok(manifest.scripts.test);

  for (const [name, version] of Object.entries(pinnedDependencies)) {
    assert.equal(manifest.dependencies[name], version);
  }

  assert.ok(manifest.devDependencies.typescript);
  assert.ok(manifest.devDependencies["@types/node"]);
});

test("lockfile reproduces the exact direct dependency versions", async () => {
  const lockfile = await readJson("package-lock.json");

  assert.equal(lockfile.lockfileVersion, 3);
  for (const [name, version] of Object.entries(pinnedDependencies)) {
    assert.equal(lockfile.packages[""].dependencies[name], version);
    assert.equal(lockfile.packages[`node_modules/${name}`].version, version);
  }
});

test("TypeScript is configured for strict Node.js ESM output", async () => {
  const tsconfig = await readJson("tsconfig.json");

  assert.equal(tsconfig.compilerOptions.module, "NodeNext");
  assert.equal(tsconfig.compilerOptions.moduleResolution, "NodeNext");
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.outDir, "dist");
});

test("official Pi packages and decimal arithmetic expose their contract entry points", async () => {
  const [agentCore, piAi, decimalModule] = await Promise.all([
    import("@earendil-works/pi-agent-core"),
    import("@earendil-works/pi-ai"),
    import("decimal.js"),
  ]);

  assert.equal(typeof agentCore.Agent, "function");
  assert.equal(typeof piAi.createModels, "function");
  assert.equal(typeof piAi.fauxProvider, "function");
  assert.equal(typeof decimalModule.default, "function");
});
