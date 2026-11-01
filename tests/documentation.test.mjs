import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("required delivery documents and review entry points exist", async () => {
  const required = [
    "README.md",
    "docs/01-requirements.md",
    "docs/02-solution.md",
    "docs/03-evaluation.md",
    "docs/04-ai-usage.md",
    "docs/05-retrospective.md",
    ".env.example",
    "examples/README.md",
  ];
  for (const file of required) await stat(path.join(root, file));

  const readme = await text("README.md");
  for (const command of ["npm ci", "npm run build", "npm test", "--offline", "CONTENT_PLANNER_PROVIDER"]) {
    assert.ok(readme.includes(command), `README missing ${command}`);
  }
  assert.ok(readme.includes("docs/03-evaluation.md"));
  assert.ok(readme.includes("Mock"));
});

test("evaluation links resolve and real-model limitations are explicit", async () => {
  const evaluation = await text("docs/03-evaluation.md");
  assert.ok(evaluation.includes("真实"));
  assert.ok(evaluation.includes("未"));
  assert.ok(evaluation.includes("Mock"));
  const links = [...evaluation.matchAll(/`((?:examples|tests)\/[^`]+)`/g)].map((match) => match[1]);
  assert.ok(links.length >= 3);
  for (const link of links) await stat(path.join(root, link));

  const aiUsage = await text("docs/04-ai-usage.md");
  assert.ok(aiUsage.includes("AI"));
  assert.ok(aiUsage.includes("个人"));
  assert.ok(aiUsage.includes("验证"));
  assert.ok(aiUsage.includes("用时"));
});

test("environment example contains no concrete credentials and original exam HTML is absent", async () => {
  const envExample = await text(".env.example");
  for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY"]) {
    assert.ok(envExample.includes(`${name}=`));
    assert.ok(!new RegExp(`${name}=\\S+`).test(envExample), `${name} has a concrete value`);
  }
  const tracked = await text(".gitignore");
  assert.ok(tracked.includes("小影科技2027校招-AI Agent笔试题"));
});
