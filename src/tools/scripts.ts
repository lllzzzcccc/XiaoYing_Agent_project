import { randomUUID } from "node:crypto";
import type { CampaignPlan } from "../domain/planning.js";
import type { RunState, ScriptRecord } from "../domain/run-state.js";
import { throwIfInjected, ToolError, type ToolFaults } from "./errors.js";
import type { Material } from "./materials.js";
import { registerPlan } from "./plans.js";

export interface GenerateScriptParams {
  plan: CampaignPlan;
  material_ids: string[];
}

function retrievedMaterials(state: RunState): Map<string, Material> {
  const retrieved = new Map<string, Material>();
  for (const search of state.material_searches) {
    for (const item of search.items) {
      const material = item as Material;
      retrieved.set(material.material_id, material);
    }
  }
  return retrieved;
}

export function executeGenerateScript(
  state: RunState,
  params: GenerateScriptParams,
  faults?: ToolFaults,
): ScriptRecord {
  throwIfInjected(faults, "generate_script");
  if (!Array.isArray(params.material_ids) || params.material_ids.length === 0 ||
      new Set(params.material_ids).size !== params.material_ids.length) {
    throw new ToolError({ code: "VALIDATION_ERROR", message: "material_ids 必须非空且不得重复" });
  }

  const retrieved = retrievedMaterials(state);
  const materials = params.material_ids.map((materialId) => {
    const material = retrieved.get(materialId);
    if (!material) {
      throw new ToolError({
        code: "DEPENDENCY_NOT_MET",
        message: `素材 ${materialId} 尚未成功检索`,
        details: { material_id: materialId },
      });
    }
    return material;
  });

  const registered = registerPlan(state, params.plan);
  const content = [
    `主题：${state.request.theme}`,
    `方案：${params.plan.title}`,
    ...materials.map((material) => `素材 ${material.material_id}：${material.facts.join("；")}`),
  ].join("\n");
  const script: ScriptRecord = {
    script_id: `script-${randomUUID()}`,
    plan_id: params.plan.plan_id,
    plan_fingerprint: registered.plan_fingerprint,
    title: `${params.plan.title}｜${state.request.theme}`,
    content,
    material_ids: [...params.material_ids],
    material_references: materials.map((material) => ({
      material_id: material.material_id,
      facts: [...material.facts],
    })),
    generated_at: new Date().toISOString(),
    valid: true,
  };
  state.scripts.push(script);
  return structuredClone(script);
}
