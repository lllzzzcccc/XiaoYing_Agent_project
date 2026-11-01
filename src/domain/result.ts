export type RunMode = "real" | "mock";
export type FinalStatus = "completed" | "incomplete";

export interface ResultReason {
  code: string;
  message: string;
  step_id?: string;
  budget_gap?: number;
  current_cost?: number;
  estimated_completion_at?: string;
}

export interface RunResult {
  schema_version: 1;
  request_id: string;
  duplicate: boolean;
  status: FinalStatus;
  mode: RunMode;
  task_plan: Record<string, unknown> | null;
  steps: Array<Record<string, unknown>>;
  tool_results: Array<Record<string, unknown>>;
  current_cost: Record<string, unknown> | null;
  duration: Record<string, unknown> | null;
  saved_plan: Record<string, unknown> | null;
  reasons: ResultReason[];
  trace: {
    path: string | null;
    mode: RunMode;
  };
}

export function createInitialResult(requestId: string, mode: RunMode): RunResult {
  return {
    schema_version: 1,
    request_id: requestId,
    duplicate: false,
    status: "incomplete",
    mode,
    task_plan: null,
    steps: [],
    tool_results: [],
    current_cost: null,
    duration: null,
    saved_plan: null,
    reasons: [],
    trace: { path: null, mode },
  };
}

export function createRequestConflictResult(requestId: string, mode: RunMode): RunResult {
  const result = createInitialResult(requestId, mode);
  result.reasons = [{ code: "REQUEST_CONFLICT", message: "request_id 已用于不同输入" }];
  return result;
}

export function markDuplicateResult(result: RunResult): RunResult {
  const duplicate = structuredClone(result);
  duplicate.duplicate = true;
  return duplicate;
}
