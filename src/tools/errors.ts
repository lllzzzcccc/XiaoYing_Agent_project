import type { ToolErrorInfo } from "../domain/run-state.js";

export interface ToolFault {
  code?: string;
  message: string;
  retryable?: boolean;
}

export type ToolFaults = Record<string, ToolFault | undefined>;

export class ToolError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: unknown;
  readonly injected: boolean | undefined;

  constructor(options: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: unknown;
    injected?: boolean;
  }) {
    super(options.message);
    this.name = "ToolError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.injected = options.injected;
  }
}

export function throwIfInjected(faults: ToolFaults | undefined, toolName: string): void {
  const fault = faults?.[toolName];
  if (!fault) return;
  throw new ToolError({
    code: fault.code ?? "INJECTED_FAILURE",
    message: fault.message,
    retryable: fault.retryable ?? true,
    injected: true,
  });
}

export function asToolErrorInfo(error: unknown): ToolErrorInfo {
  if (error instanceof ToolError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(error.injected === undefined ? {} : { injected: error.injected }),
    };
  }
  return {
    code: "TOOL_FAILURE",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
