import { Agent, type AgentMessage, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { CampaignPlan, CostItem } from "../domain/planning.js";
import type { RunState, RunStep } from "../domain/run-state.js";
import { finishRunStep, startRunStep } from "../domain/steps.js";
import type { RequestStore } from "../store/request-store.js";
import { TraceWriter } from "../trace/trace.js";
import { asToolErrorInfo, ToolError, type ToolFaults } from "../tools/errors.js";
import { executeEstimateCost } from "../tools/estimates.js";
import { executeSearchMaterials, type Material, type SearchMaterialsParams } from "../tools/materials.js";
import { executeSavePlan, type SavePlanParams } from "../tools/save-plan.js";
import { executeGenerateScript, type GenerateScriptParams } from "../tools/scripts.js";

export interface PiAgentRunOptions {
  model: Model<any>;
  streamFn: StreamFn;
  store: RequestStore;
  materials: Material[];
  costItems: CostItem[];
  faults?: ToolFaults;
}

function publicText(message: AgentMessage): string | undefined {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return undefined;
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text === "" ? undefined : text;
}

function toolResult(details: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  };
}

const campaignPlanSchema = {
  type: "object",
  required: ["plan_id", "title", "steps"],
  properties: {
    plan_id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["step_id", "title", "cost_item_id", "depends_on"],
        properties: {
          step_id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          cost_item_id: { type: "string", minLength: 1 },
          depends_on: { type: "array", items: { type: "string" } },
          quantity: { type: "integer", minimum: 1 },
        },
      },
    },
  },
} as AgentTool["parameters"];

function buildSystemPrompt(state: RunState, costItems: CostItem[]): string {
  return [
    "你是内容任务规划 Agent。根据实际工具观察自主选择下一步，不要按固定顺序机械执行。",
    "目标是在预算和截止时间内保存内容活动方案。不得修改用户主题、预算或截止时间。",
    "可使用 search_materials、generate_script、estimate_cost、save_plan。无素材时可改写查询；仍无结果则停止。",
    "成本或时间不可行是工具观察，应选择替代方案并重新估算，或明确停止。失败步骤不得称为成功。",
    "保存前必须有与当前方案指纹一致的有效脚本和可行估算。保存成功后结束；无法继续时结束。",
    "每次选择工具或结束前，用一句公开文本说明简短决策依据；不要输出隐藏推理。",
    `用户请求：${JSON.stringify(state.request)}`,
    `费用项目录：${JSON.stringify(costItems)}`,
  ].join("\n");
}

function createTools(state: RunState, options: PiAgentRunOptions, errors: Map<string, unknown>): AgentTool[] {
  function capture(toolCallId: string, error: unknown): never {
    errors.set(toolCallId, error);
    throw error;
  }

  return [
    {
      name: "search_materials",
      label: "素材检索",
      description: "检索合成素材；空列表表示无匹配，可调整查询",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
      } as AgentTool["parameters"],
      execute: async (toolCallId, params) => {
        try {
          return toolResult(executeSearchMaterials(state, options.materials, params as SearchMaterialsParams, options.faults));
        } catch (error) {
          return capture(toolCallId, error);
        }
      },
    },
    {
      name: "generate_script",
      label: "脚本生成",
      description: "基于当前候选方案和已检索素材生成脚本",
      parameters: {
        type: "object",
        required: ["plan", "material_ids"],
        properties: {
          plan: campaignPlanSchema,
          material_ids: { type: "array", minItems: 1, items: { type: "string" } },
        },
      } as AgentTool["parameters"],
      execute: async (toolCallId, params) => {
        try {
          return toolResult(executeGenerateScript(state, params as GenerateScriptParams, options.faults));
        } catch (error) {
          return capture(toolCallId, error);
        }
      },
    },
    {
      name: "estimate_cost",
      label: "成本估算",
      description: "计算候选方案费用、串行耗时和可行性；不可行不是工具异常",
      parameters: {
        type: "object",
        required: ["plan"],
        properties: { plan: campaignPlanSchema },
      } as AgentTool["parameters"],
      execute: async (toolCallId, params) => {
        try {
          const typed = params as { plan: CampaignPlan };
          return toolResult(executeEstimateCost(state, options.costItems, typed, options.faults));
        } catch (error) {
          return capture(toolCallId, error);
        }
      },
    },
    {
      name: "save_plan",
      label: "方案保存",
      description: "将当前可行且脚本匹配的方案保存为本地 JSON",
      parameters: {
        type: "object",
        required: ["plan_id"],
        properties: { plan_id: { type: "string", minLength: 1 } },
      } as AgentTool["parameters"],
      execute: async (toolCallId, params) => {
        try {
          return toolResult(await executeSavePlan(state, options.store, params as SavePlanParams, options.faults));
        } catch (error) {
          return capture(toolCallId, error);
        }
      },
    },
  ];
}

export async function runPiAgent(state: RunState, options: PiAgentRunOptions): Promise<RunState> {
  const trace = await TraceWriter.create({ path: state.trace_path, requestId: state.request_id, mode: state.mode });
  const errors = new Map<string, unknown>();
  const steps = new Map<string, RunStep>();
  let awaitingDecision = false;
  let latestDecisionNote: string | undefined;

  const agent = new Agent({
    initialState: {
      model: options.model,
      systemPrompt: buildSystemPrompt(state, options.costItems),
      tools: createTools(state, options, errors),
    },
    streamFn: options.streamFn,
    toolExecution: "sequential",
    sessionId: state.request_id,
    beforeToolCall: async ({ toolCall, args, assistantMessage }) => {
      if (awaitingDecision) {
        await trace.attachDecision(toolCall.name, publicText(assistantMessage));
        awaitingDecision = false;
      }
      if (state.tool_call_count >= state.max_tool_calls) {
        state.limit_reached = true;
        state.reasons = [{ code: "EXECUTION_LIMIT_REACHED", message: "已达到工具调用次数上限" }];
        await trace.record({ type: "limit_reached", tool_name: toolCall.name, args, error: {
          code: "EXECUTION_LIMIT_REACHED",
          message: "已达到工具调用次数上限",
          retryable: false,
        } });
        await options.store.save(state);
        return { block: true, reason: "已达到工具调用次数上限", terminate: true };
      }

      const argsRecord = args as { plan?: CampaignPlan; plan_id?: string };
      const planId = argsRecord.plan?.plan_id ?? argsRecord.plan_id;
      const planFingerprint = argsRecord.plan ? state.current_plan_fingerprint ?? undefined : undefined;
      const step = startRunStep(state, {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args,
        ...(planId ? { planId } : {}),
        ...(planFingerprint ? { planFingerprint } : {}),
      });
      steps.set(toolCall.id, step);
      await trace.record({
        type: "tool_start",
        step_id: step.step_id,
        tool_name: toolCall.name,
        args,
        ...(step.plan_id ? { plan_id: step.plan_id } : {}),
        ...(step.plan_fingerprint ? { plan_fingerprint: step.plan_fingerprint } : {}),
      });
      await options.store.save(state);
      return undefined;
    },
    afterToolCall: async ({ toolCall, args, result, isError }) => {
      const step = steps.get(toolCall.id);
      if (!step) return undefined;
      const error = isError
        ? errors.has(toolCall.id)
          ? asToolErrorInfo(errors.get(toolCall.id))
          : asToolErrorInfo(new ToolError({ code: "TOOL_FAILURE", message: "工具执行失败" }))
        : null;
      finishRunStep(state, step, {
        status: isError ? "failed" : "succeeded",
        resultSummary: isError ? result.content : result.details,
        ...(error ? { error } : {}),
      });
      await trace.record({
        type: "tool_end",
        step_id: step.step_id,
        tool_name: toolCall.name,
        args,
        result_summary: step.result_summary,
        ...(error ? { error } : {}),
        ...(step.plan_id ? { plan_id: step.plan_id } : {}),
        ...(step.plan_fingerprint ? { plan_fingerprint: step.plan_fingerprint } : {}),
      });
      awaitingDecision = true;
      await options.store.save(state);
      return undefined;
    },
  });

  agent.subscribe(async (event) => {
    if (event.type === "message_end") latestDecisionNote = publicText(event.message);
    if (event.type === "agent_end") {
      if (awaitingDecision) {
        await trace.attachDecision("end", latestDecisionNote);
        awaitingDecision = false;
      }
      await trace.record({ type: "run_end", result_summary: {
        status: state.status,
        limit_reached: state.limit_reached,
        saved: state.saved_plan !== null,
      } });
      await options.store.save(state);
    }
  });

  await agent.prompt(`请处理请求 ${state.request_id}，根据工具观察完成或明确停止。`);
  return state;
}
