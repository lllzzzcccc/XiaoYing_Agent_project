import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunMode } from "../domain/result.js";
import type { ToolErrorInfo } from "../domain/run-state.js";

export interface TraceEvent {
  event_id: string;
  request_id: string;
  timestamp: string;
  mode: RunMode;
  sequence: number;
  type: string;
  step_id: string | null;
  tool_name: string | null;
  args: unknown;
  result_summary: unknown;
  error: ToolErrorInfo | null;
  next_action: string | null;
  decision_note: string | null;
  plan_id: string | null;
  plan_fingerprint: string | null;
}

interface TraceRecordInput {
  type: string;
  step_id?: string;
  tool_name?: string;
  args?: unknown;
  result_summary?: unknown;
  error?: ToolErrorInfo;
  next_action?: string;
  decision_note?: string;
  plan_id?: string;
  plan_fingerprint?: string;
}

export class TraceWriter {
  readonly path: string;
  readonly requestId: string;
  readonly mode: RunMode;
  readonly events: TraceEvent[];

  private constructor(options: { path: string; requestId: string; mode: RunMode; events: TraceEvent[] }) {
    this.path = options.path;
    this.requestId = options.requestId;
    this.mode = options.mode;
    this.events = options.events;
  }

  static async create(options: { path: string; requestId: string; mode: RunMode }): Promise<TraceWriter> {
    let events: TraceEvent[] = [];
    try {
      const raw = await readFile(options.path, "utf8");
      events = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as TraceEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return new TraceWriter({ ...options, events });
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const content = this.events.map((event) => JSON.stringify(event)).join("\n") + "\n";
      await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, this.path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async record(input: TraceRecordInput): Promise<TraceEvent> {
    const event: TraceEvent = {
      event_id: `event-${randomUUID()}`,
      request_id: this.requestId,
      timestamp: new Date().toISOString(),
      mode: this.mode,
      sequence: (this.events.at(-1)?.sequence ?? 0) + 1,
      type: input.type,
      step_id: input.step_id ?? null,
      tool_name: input.tool_name ?? null,
      args: input.args ?? null,
      result_summary: input.result_summary ?? null,
      error: input.error ?? null,
      next_action: input.next_action ?? null,
      decision_note: input.decision_note ?? null,
      plan_id: input.plan_id ?? null,
      plan_fingerprint: input.plan_fingerprint ?? null,
    };
    this.events.push(event);
    await this.persist();
    return event;
  }

  async attachDecision(nextAction: string, decisionNote?: string): Promise<void> {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index]!;
      if (event.type === "tool_end" && event.next_action === null) {
        event.next_action = nextAction;
        event.decision_note = typeof decisionNote === "string" ? decisionNote : null;
        await this.persist();
        return;
      }
    }
    throw new Error("没有可关联后续动作的工具事件");
  }
}
