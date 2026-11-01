import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function normalizeEvidence(value, projectRoot) {
  const rootPrefix = projectRoot.endsWith(path.sep) ? projectRoot : `${projectRoot}${path.sep}`;
  if (typeof value === "string") return value.split(rootPrefix).join("");
  if (Array.isArray(value)) return value.map((item) => normalizeEvidence(item, projectRoot));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeEvidence(entry, projectRoot)]),
    );
  }
  return value;
}

export async function writeEvidenceJson(filePath, value, projectRoot) {
  await writeFile(filePath, `${JSON.stringify(normalizeEvidence(value, projectRoot), null, 2)}\n`);
}

export async function writeEvidenceJsonl(filePath, events, projectRoot) {
  const normalized = normalizeEvidence(events, projectRoot);
  await writeFile(filePath, `${normalized.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

export async function copyEvidenceJson(source, target, projectRoot) {
  await writeEvidenceJson(target, JSON.parse(await readFile(source, "utf8")), projectRoot);
}

export async function copyEvidenceJsonl(source, target, projectRoot) {
  const events = (await readFile(source, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  await writeEvidenceJsonl(target, events, projectRoot);
}
