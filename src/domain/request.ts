export interface PlanningRequest {
  request_id: string;
  theme: string;
  budget: number;
  deadline: string;
}

export interface InputReason {
  code: "INPUT_MISSING" | "INPUT_INVALID";
  field: string | null;
  message: string;
}

export interface ParsedPlanningRequest {
  request: PlanningRequest;
  originalInput: Record<string, unknown>;
}

export class InputValidationError extends Error {
  readonly reasons: InputReason[];
  readonly originalInput: Record<string, unknown> | null;

  constructor(reasons: InputReason[], originalInput: Record<string, unknown> | null = null) {
    super(reasons.map((reason) => reason.message).join("; "));
    this.name = "InputValidationError";
    this.reasons = reasons;
    this.originalInput = originalInput;
  }
}

function isValidIsoDateTime(value: string): boolean {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const zone = match[7]!;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;

  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]!) return false;

  if (zone !== "Z") {
    const [offsetHour, offsetMinute] = zone.slice(1).split(":").map(Number);
    if (offsetHour! > 23 || offsetMinute! > 59) return false;
  }

  return Number.isFinite(Date.parse(value));
}

export function parsePlanningRequest(text: string): ParsedPlanningRequest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InputValidationError([
      { code: "INPUT_INVALID", field: null, message: "输入必须是合法 JSON" },
    ]);
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputValidationError([
      { code: "INPUT_INVALID", field: null, message: "输入必须是 JSON 对象" },
    ]);
  }

  const originalInput = value as Record<string, unknown>;
  const reasons: InputReason[] = [];
  const required = ["request_id", "theme", "budget", "deadline"] as const;
  for (const field of required) {
    if (!(field in originalInput)) {
      reasons.push({ code: "INPUT_MISSING", field, message: `缺少必填字段 ${field}` });
    }
  }

  if ("request_id" in originalInput &&
      (typeof originalInput.request_id !== "string" || originalInput.request_id.trim() === "")) {
    reasons.push({ code: "INPUT_INVALID", field: "request_id", message: "request_id 必须是非空字符串" });
  }
  if ("theme" in originalInput &&
      (typeof originalInput.theme !== "string" || originalInput.theme.trim() === "")) {
    reasons.push({ code: "INPUT_INVALID", field: "theme", message: "theme 必须是非空字符串" });
  }
  if ("budget" in originalInput &&
      (typeof originalInput.budget !== "number" || !Number.isFinite(originalInput.budget) || originalInput.budget < 0)) {
    reasons.push({ code: "INPUT_INVALID", field: "budget", message: "budget 必须是有限非负数" });
  }
  if ("deadline" in originalInput &&
      (typeof originalInput.deadline !== "string" || !isValidIsoDateTime(originalInput.deadline))) {
    reasons.push({ code: "INPUT_INVALID", field: "deadline", message: "deadline 必须是含时区的合法 ISO-8601 时间" });
  }

  if (reasons.length > 0) throw new InputValidationError(reasons, originalInput);

  return {
    request: {
      request_id: originalInput.request_id as string,
      theme: originalInput.theme as string,
      budget: originalInput.budget as number,
      deadline: originalInput.deadline as string,
    },
    originalInput,
  };
}
