import type { CampaignPlan, PlanEstimate } from "./planning.js";
import type { PlanningRequest } from "./request.js";
import type { ResultReason, RunMode, RunResult } from "./result.js";

export type RunStatus = "running" | "completed" | "incomplete";
export type RunStepStatus = "pending" | "running" | "succeeded" | "failed" | "blocked" | "skipped" | "invalidated";

export interface ToolErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
  injected?: boolean;
}

export interface RunStep {
  step_id: string;
  tool_call_id: string;
  tool_name: string;
  attempt: number;
  status: RunStepStatus;
  depends_on: string[];
  args: unknown;
  result_summary: unknown;
  error: ToolErrorInfo | null;
  plan_id: string | null;
  plan_fingerprint: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface MaterialSearch {
  query: string;
  items: Array<Record<string, unknown>>;
  count: number;
  timestamp: string;
}

export interface ScriptRecord {
  script_id: string;
  plan_id: string;
  plan_fingerprint: string;
  title: string;
  content: string;
  material_ids: string[];
  material_references: Array<Record<string, unknown>>;
  generated_at: string;
  valid: boolean;
}

export interface EstimateRecord extends PlanEstimate {
  estimate_id: string;
  estimated_at: string;
  valid: boolean;
}

export interface PlanRecord {
  plan: CampaignPlan;
  plan_fingerprint: string;
  current: boolean;
}

export interface SavedPlanReference {
  request_id: string;
  plan_id: string;
  plan_fingerprint: string;
  saved_at: string;
  path: string;
  already_saved: boolean;
}

export interface RunState {
  schema_version: 1;
  request_id: string;
  input_fingerprint: string;
  original_input: Record<string, unknown>;
  request: PlanningRequest;
  mode: RunMode;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  current_plan_id: string | null;
  current_plan_fingerprint: string | null;
  plans: Record<string, PlanRecord>;
  material_searches: MaterialSearch[];
  scripts: ScriptRecord[];
  estimates: EstimateRecord[];
  steps: RunStep[];
  tool_call_count: number;
  max_tool_calls: number;
  limit_reached: boolean;
  saved_plan: SavedPlanReference | null;
  reasons: ResultReason[];
  original_result: RunResult | null;
  trace_path: string;
}

export function createRunState(options: {
  request: PlanningRequest;
  originalInput: Record<string, unknown>;
  inputFingerprint: string;
  mode: RunMode;
  startedAt: string;
  maxToolCalls: number;
  tracePath: string;
}): RunState {
  return {
    schema_version: 1,
    request_id: options.request.request_id,
    input_fingerprint: options.inputFingerprint,
    original_input: structuredClone(options.originalInput),
    request: structuredClone(options.request),
    mode: options.mode,
    status: "running",
    started_at: options.startedAt,
    finished_at: null,
    current_plan_id: null,
    current_plan_fingerprint: null,
    plans: {},
    material_searches: [],
    scripts: [],
    estimates: [],
    steps: [],
    tool_call_count: 0,
    max_tool_calls: options.maxToolCalls,
    limit_reached: false,
    saved_plan: null,
    reasons: [],
    original_result: null,
    trace_path: options.tracePath,
  };
}
