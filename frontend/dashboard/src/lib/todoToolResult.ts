export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  cancelled: number;
}

export interface TodoToolResult {
  todos: TodoItem[];
  summary: TodoSummary;
  /**
   * Monotonic stamp set when a live SSE result produced this snapshot.
   * Lets a server resync be compared by recency instead of by progress —
   * a plan replaced via `merge=false` legitimately resets `completed` to 0,
   * so "more completed" is not the same as "newer".
   */
  receivedAt?: number;
}

const VALID_STATUSES = new Set<TodoStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseStatus(value: unknown): TodoStatus {
  const raw = asString(value);
  if (raw && VALID_STATUSES.has(raw as TodoStatus)) {
    return raw as TodoStatus;
  }
  return "pending";
}

function parseSummary(data: Record<string, unknown>): TodoSummary {
  const summary = asRecord(data.summary);
  if (!summary) {
    return {
      total: 0,
      pending: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    };
  }

  return {
    total: asNumber(summary.total),
    pending: asNumber(summary.pending),
    in_progress: asNumber(summary.in_progress),
    completed: asNumber(summary.completed),
    cancelled: asNumber(summary.cancelled),
  };
}

function parseItems(data: Record<string, unknown>): TodoItem[] {
  if (!Array.isArray(data.todos)) return [];

  const items: TodoItem[] = [];
  for (const entry of data.todos) {
    const row = asRecord(entry);
    if (!row) continue;

    const content = (asString(row.content) ?? asString(row.text) ?? "").trim();
    if (!content) continue;

    items.push({
      id: asString(row.id) ?? `todo-${items.length}`,
      content,
      status: parseStatus(row.status),
    });
  }

  return items;
}

export function parseTodoToolResult(raw: string | null | undefined): TodoToolResult | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const data = asRecord(parsed);
    if (!data) return null;

    const todos = parseItems(data);
    const summary = parseSummary(data);

    if (todos.length === 0 && summary.total === 0) return null;

    return { todos, summary };
  } catch {
    return null;
  }
}

export function todoProgressPercent(summary: TodoSummary): number {
  if (summary.total <= 0) return 0;
  return Math.round((summary.completed / summary.total) * 100);
}

export function todoHasOpenWork(summary: TodoSummary): boolean {
  return summary.pending > 0 || summary.in_progress > 0;
}

export function resolveLatestTodoToolId(
  toolCalls: Array<{ id: string; name: string; result?: string }>,
): string | null {
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const tc = toolCalls[i];
    if (!tc || tc.name.trim().toLowerCase() !== "todo") continue;
    if (parseTodoToolResult(tc.result)) return tc.id;
  }
  return null;
}

export function resolveLatestTodoResult(input: {
  todoSnapshot?: TodoToolResult | null;
  toolCalls?: Array<{ id: string; name: string; result?: string }>;
}): TodoToolResult | null {
  if (input.todoSnapshot) return input.todoSnapshot;

  const tools = input.toolCalls ?? [];
  for (let i = tools.length - 1; i >= 0; i -= 1) {
    const tc = tools[i];
    if (!tc || tc.name.trim().toLowerCase() !== "todo") continue;
    const parsed = parseTodoToolResult(tc.result);
    if (parsed) return parsed;
  }
  return null;
}
