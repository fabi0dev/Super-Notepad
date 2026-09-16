import type { LogsQueryParams } from "@/lib/queries/logs";

export const queryKeys = {
  setup: {
    status: (sessionId?: string | null) =>
      ["setup", "status", sessionId ?? "global"] as const,
    catalog: ["setup", "catalog"] as const,
  },
  sessions: {
    all: ["sessions"] as const,
    list: () => [...queryKeys.sessions.all, "list"] as const,
    count: () => [...queryKeys.sessions.all, "count"] as const,
    messages: (id: string) => [...queryKeys.sessions.all, id, "messages"] as const,
    detail: (id: string) => [...queryKeys.sessions.all, id, "detail"] as const,
    chapters: (id: string) => [...queryKeys.sessions.all, id, "chapters"] as const,
  },
  config: {
    root: ["config"] as const,
    schema: ["config", "schema"] as const,
  },
  chatContext: (sessionId?: string | null) =>
    ["chat", "context", (sessionId ?? "").trim() || "new"] as const,
  chatActive: ["chat", "active"] as const,
  contextUsage: (sessionId?: string | null) =>
    ["chat", "context-usage", (sessionId ?? "").trim() || "new"] as const,
  chatEffort: (sessionId?: string | null) =>
    ["chat", "effort", (sessionId ?? "").trim() || "new"] as const,
  terminals: (sessionId: string | null) => ["terminals", sessionId] as const,
  noteLinks: (sessionId: string | null) =>
    ["note-links", "session", sessionId] as const,
  modelInfo: (sessionId?: string | null) =>
    ["model", "info", sessionId ?? "global"] as const,
  modelOptions: (sessionId?: string | null) =>
    ["model", "options", sessionId ?? "global"] as const,
  workingDirectory: (sessionId?: string | null) =>
    ["cwd", sessionId ?? "global"] as const,
  projects: {
    recent: (limit?: number) => ["projects", "recent", limit ?? 10] as const,
    browse: (path: string, query: string, hideHidden: boolean) =>
      ["projects", "browse", path, query, hideHidden] as const,
  },
  skills: {
    all: ["skills"] as const,
    toolsets: ["toolsets"] as const,
  },
  memory: {
    all: ["memory"] as const,
  },
  cron: {
    jobs: ["cron", "jobs"] as const,
  },
  env: {
    vars: ["env"] as const,
  },
  analytics: (days: number) => ["analytics", days] as const,
  logs: (params: LogsQueryParams) => ["logs", params] as const,
  sidebarStatus: ["status", "sidebar"] as const,
  gateway: {
    platforms: ["gateway", "platforms"] as const,
  },
} as const;
