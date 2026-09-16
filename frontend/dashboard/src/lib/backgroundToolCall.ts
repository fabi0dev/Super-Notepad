import type { ToolCallEvent } from "@/pages/ChatPage/components/types";
import { applyAssistantSegments } from "@/pages/ChatPage/chatTurnSegments";
import type { ChatMessage, TurnSegment } from "@/pages/ChatPage/components/types";
import { collectToolCalls } from "@/pages/ChatPage/reasoningLabels";

export const BACKGROUND_STARTED_OUTPUT = "Background process started";

type JsonRecord = Record<string, unknown>;

function parseJsonRecord(raw?: string): JsonRecord | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonRecord;
    }
  } catch {
    return null;
  }
  return null;
}

export interface BackgroundSpawnInfo {
  procSessionId: string;
  liveLabel: string;
}

export function isBackgroundSpawnResult(rawResult?: string): boolean {
  const result = parseJsonRecord(rawResult);
  if (!result) return false;
  if (result.background_exited === true) return false;
  const procSessionId =
    typeof result.session_id === "string" ? result.session_id.trim() : "";
  const output = typeof result.output === "string" ? result.output : "";
  return (
    procSessionId.startsWith("proc_") &&
    output.includes(BACKGROUND_STARTED_OUTPUT)
  );
}

export function hasBackgroundExitedMarker(rawResult?: string): boolean {
  const result = parseJsonRecord(rawResult);
  return result?.background_exited === true;
}

export function isTerminalBackgroundArgs(rawArgs?: string): boolean {
  const args = parseJsonRecord(rawArgs);
  return args?.background === true;
}

function buildBackgroundLiveLabel(rawArgs?: string, fallback?: string): string {
  const args = parseJsonRecord(rawArgs);
  const description =
    typeof args?.description === "string" ? args.description.trim() : "";
  if (description) {
    return `${description} — executando em segundo plano…`;
  }
  const trimmedFallback = (fallback ?? "").trim();
  if (trimmedFallback) {
    return `${trimmedFallback} — executando em segundo plano…`;
  }
  return "Executando em segundo plano…";
}

export function detectBackgroundSpawn(
  toolName: string,
  rawArgs?: string,
  rawResult?: string,
  liveLabelFallback?: string,
): BackgroundSpawnInfo | null {
  const normalized = toolName.trim().toLowerCase();
  if (normalized !== "terminal" && normalized !== "shell") return null;
  if (!isBackgroundSpawnResult(rawResult)) return null;

  const result = parseJsonRecord(rawResult);
  const procSessionId =
    typeof result?.session_id === "string" ? result.session_id.trim() : "";
  if (!procSessionId) return null;

  return {
    procSessionId,
    liveLabel: buildBackgroundLiveLabel(rawArgs, liveLabelFallback),
  };
}

export function enrichBackgroundRunningTool(
  tc: ToolCallEvent,
  spawnStartedAtMs?: number,
): ToolCallEvent {
  if (hasBackgroundExitedMarker(tc.result)) return tc;
  if (tc.backgroundProcId && tc.status === "running") return tc;
  const bg = detectBackgroundSpawn(
    tc.name,
    tc.args,
    tc.result,
    tc.liveLabel,
  );
  if (!bg) return tc;
  return {
    ...tc,
    status: "running",
    backgroundProcId: bg.procSessionId,
    liveLabel: bg.liveLabel,
    // A hora REAL do spawn (do histórico) em vez de `Date.now()`: sem isso,
    // um processo antigo recarregado aparecia como "0s" contando do zero,
    // parecendo recém-iniciado. Também é o sinal de idade que o poll usa para
    // finalizar na hora um processo antigo ausente do registro.
    startedAt: tc.startedAt ?? spawnStartedAtMs ?? Date.now(),
  };
}

export function enrichMessageBackgroundTools(msg: ChatMessage): ChatMessage {
  if (msg.role !== "assistant") return msg;

  const currentTools = collectToolCalls(msg);
  if (currentTools.length === 0) return msg;

  const rawTs = msg.timestamp;
  const spawnStartedAtMs =
    typeof rawTs === "number" && rawTs > 0
      ? rawTs < 1e12
        ? rawTs * 1000
        : rawTs
      : undefined;
  const enrichedTools = currentTools.map((tc) =>
    enrichBackgroundRunningTool(tc, spawnStartedAtMs),
  );
  const toolsChanged = enrichedTools.some((tc, i) => tc !== currentTools[i]);
  if (!toolsChanged) return msg;

  const byId = new Map(enrichedTools.map((tc) => [tc.id, tc]));
  const byServer = new Map(
    enrichedTools
      .filter((tc) => tc.serverId)
      .map((tc) => [tc.serverId as string, tc]),
  );

  const patchTool = (tc: ToolCallEvent): ToolCallEvent => {
    const next =
      byId.get(tc.id) ??
      (tc.serverId ? byServer.get(tc.serverId) : undefined);
    return next ?? tc;
  };

  const segments: TurnSegment[] = (msg.segments ?? []).map((segment) => {
    if (segment.kind !== "tools") return segment;
    return {
      kind: "tools" as const,
      toolCalls: segment.toolCalls.map(patchTool),
    };
  });

  const base: ChatMessage = {
    ...msg,
    toolCalls: enrichedTools,
    segments,
  };

  return {
    ...base,
    ...applyAssistantSegments(base, segments, msg.streamingBuffer ?? ""),
  };
}

export function enrichAllMessagesBackgroundTools(
  messages: ChatMessage[],
): ChatMessage[] {
  let changed = false;
  const next = messages.map((msg) => {
    const enriched = enrichMessageBackgroundTools(msg);
    if (enriched !== msg) changed = true;
    return enriched;
  });
  return changed ? next : messages;
}

export function messageHasBackgroundSpawnCandidate(msg: ChatMessage): boolean {
  if (msg.role !== "assistant") return false;
  return collectToolCalls(msg).some(
    (tc) =>
      (tc.name === "terminal" || tc.name === "shell") &&
      isBackgroundSpawnResult(tc.result) &&
      tc.status !== "running" &&
      !tc.backgroundProcId &&
      !hasBackgroundExitedMarker(tc.result),
  );
}

export function mergeBackgroundProcessOutput(
  existingResult: string | undefined,
  outputPreview: string,
  exitCode: number,
): string {
  const base = parseJsonRecord(existingResult) ?? {};
  const preview = outputPreview.trim();
  return JSON.stringify({
    ...base,
    output: preview || base.output || "",
    exit_code: exitCode,
    background_exited: true,
  });
}

/** Keep spawn marker so re-enrich still detects background tools. */
function withBackgroundSpawnMarker(output: string, existingOutput?: string): string {
  const preview = output.trim();
  const previous = (existingOutput ?? "").trim();
  if (preview.includes(BACKGROUND_STARTED_OUTPUT)) return preview;
  if (previous.includes(BACKGROUND_STARTED_OUTPUT)) {
    return preview
      ? `${BACKGROUND_STARTED_OUTPUT}\n${preview}`
      : previous;
  }
  return preview || previous;
}

export function mergeRunningBackgroundProgress(
  existingResult: string | undefined,
  outputPreview: string,
  procSessionId: string,
  uptimeSeconds: number,
): string {
  const base = parseJsonRecord(existingResult) ?? {};
  const existingOutput =
    typeof base.output === "string" ? base.output : "";
  const output = withBackgroundSpawnMarker(outputPreview, existingOutput);
  const sid =
    typeof base.session_id === "string" && base.session_id.trim()
      ? base.session_id.trim()
      : procSessionId.trim();
  return JSON.stringify({
    ...base,
    session_id: sid,
    output,
    uptime_seconds: Math.max(0, Math.floor(uptimeSeconds)),
    background_running: true,
  });
}

/** stdout útil de um processo em background ainda a correr (sem o boierplate de spawn). */
export function extractLiveBackgroundStdout(rawResult?: string): string {
  const result = parseJsonRecord(rawResult);
  if (!result) return "";
  const sessionId =
    typeof result.session_id === "string" ? result.session_id.trim() : "";
  if (!sessionId.startsWith("proc_")) return "";
  const output = typeof result.output === "string" ? result.output : "";
  if (!output.trim()) return "";
  const withoutSpawn = output
    .split(/\r?\n/)
    .filter((line) => !line.includes(BACKGROUND_STARTED_OUTPUT))
    .join("\n")
    .trim();
  return withoutSpawn || output.trim();
}

export function readBackgroundUptimeSeconds(rawResult?: string): number | null {
  const result = parseJsonRecord(rawResult);
  if (!result) return null;
  const value = result.uptime_seconds;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  return null;
}

export function formatBackgroundUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}
