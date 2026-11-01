import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url).pathname;

test("all P0 acceptance scenarios have existing offline evidence", async () => {
  const tracking = await readFile(path.join(projectRoot, "specs/acceptance.md"), "utf8");
  const required = [
    "AC-001", "AC-002", "AC-003", "AC-004", "AC-005", "AC-006", "AC-007",
    "AC-008", "AC-009", "AC-010", "AC-011", "AC-013", "AC-014", "AC-015",
    "AC-016", "AC-017", "AC-018", "AC-019",
  ];

  for (const id of required) {
    const row = tracking.split("\n").find((line) => line.startsWith(`| ${id} `));
    assert.ok(row, `${id} is missing from acceptance tracking`);
    assert.ok(!row.includes("未覆盖"), `${id} has no coverage`);
    const evidence = [...row.matchAll(/`([^`]+)`/g)]
      .map((match) => match[1])
      .filter((value) => value.startsWith("tests/") || value.startsWith("examples/"));
    assert.ok(evidence.length > 0, `${id} has no test evidence path`);
    for (const relativePath of evidence) {
      await stat(path.join(projectRoot, relativePath));
    }
  }
});
