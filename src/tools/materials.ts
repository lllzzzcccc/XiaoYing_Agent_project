import type { RunState } from "../domain/run-state.js";
import { throwIfInjected, ToolError, type ToolFaults } from "./errors.js";

export interface Material extends Record<string, unknown> {
  material_id: string;
  title: string;
  summary: string;
  facts: string[];
  tags: string[];
}

export interface SearchMaterialsParams {
  query: string;
  limit?: number;
}

export interface SearchMaterialsResult {
  query: string;
  items: Material[];
  count: number;
}

export function searchMaterials(materials: Material[], params: SearchMaterialsParams): SearchMaterialsResult {
  if (typeof params.query !== "string" || params.query.trim() === "") {
    throw new ToolError({ code: "VALIDATION_ERROR", message: "query 必须是非空字符串" });
  }
  const limit = params.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new ToolError({ code: "VALIDATION_ERROR", message: "limit 必须是 1 到 20 的整数" });
  }

  const query = params.query.trim().toLocaleLowerCase();
  const items = materials.filter((material) => {
    const searchable = [material.title, material.summary, ...material.facts, ...material.tags]
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(query);
  }).slice(0, limit);
  return { query: params.query, items, count: items.length };
}

export function executeSearchMaterials(
  state: RunState,
  materials: Material[],
  params: SearchMaterialsParams,
  faults?: ToolFaults,
): SearchMaterialsResult {
  throwIfInjected(faults, "search_materials");
  const result = searchMaterials(materials, params);
  state.material_searches.push({
    query: result.query,
    items: structuredClone(result.items),
    count: result.count,
    timestamp: new Date().toISOString(),
  });
  return result;
}
