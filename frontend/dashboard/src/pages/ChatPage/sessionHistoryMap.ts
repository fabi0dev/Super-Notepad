import type { SessionMessage } from "@/lib/api";
import {
  enrichBackgroundRunningTool,
  enrichMessageBackgroundTools,
  enrichAllMessagesBackgroundTools,
} from "@/lib/backgroundToolCall";
import {
  mergeAssistantTurnTiming,
  normalizeEpochMs,
  pickLatestTimestamp,
} from "@/lib/chatTurnTiming";
import { inferToolResultStatus } from "@/lib/formatToolResult";
import { decodeHtmlEntities } from "@/lib/decodeHtmlEntities";
import type {
  ChatMessage,
  ReasoningSegment,
  ToolCallEvent,
  TurnSegment,
} from "./components/types";
import { commitTextSegment, composeAssistantContent, assistantVisibleText } from "./chatTurnSegments";
import { extractSteerMessages } from "./steerMarker";

const nfc = (s: string): string => s.normalize("NFC");

function storedAssistantContent(raw: string | undefined | null): string {
  const text = raw || "";
  return text ? decodeHtmlEntities(text) : "";
}

function bumpTimestamp(msg: ChatMessage, ts?: number): void {
  if (ts == null) return;
  const prev = msg.timestamp;
  if (prev == null) {
    msg.timestamp = ts;
    return;
  }
  if (normalizeEpochMs(ts) > normalizeEpochMs(prev)) {
    msg.timestamp = ts;
  }
}

/**
 * Gap mínimo entre timestamps de linhas assistant para tratar como turnos
 * distintos (ex.: protocolo à noite + “bom dia” de manhã). Dentro de um
 * turno o agente emite várias linhas em segundos; acima disso o merge
 * cola bolhas e some o espaço vertical entre conversas.
 */
const ASSISTANT_TURN_BOUNDARY_MS = 90_000;

function isDistinctAssistantTurn(
  previous: ChatMessage,
  nextTimestamp?: number,
): boolean {
  if (previous.role !== "assistant") return false;
  // Turno já encerrado no cliente — o próximo assistant é outro.
  if (previous.turnCompletedAt != null) return true;
  if (previous.timestamp == null || nextTimestamp == null) return false;
  return (
    normalizeEpochMs(nextTimestamp) - normalizeEpochMs(previous.timestamp) >=
    ASSISTANT_TURN_BOUNDARY_MS
  );
}

/** ID estável por posição no snapshot do servidor — evita remount a cada poll. */
function stableHistoryMessageId(
  prefix: string,
  rawIndex: number,
  timestamp: number | undefined,
): string {
  return `${prefix}-${rawIndex}-${timestamp ?? 0}`;
}

function parseArgsRecord(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function pickRicherToolArgs(prev: string, incoming: string): string {
  const a = prev.trim();
  const b = incoming.trim();
  if (!a) return b;
  if (!b) return a;

  const aRec = parseArgsRecord(a);
  const bRec = parseArgsRecord(b);
  const aDesc =
    typeof aRec?.description === "string" ? aRec.description.trim() : "";
  const bDesc =
    typeof bRec?.description === "string" ? bRec.description.trim() : "";

  if (bDesc && !aDesc) return b;
  if (aDesc && !bDesc) return a;
  if (bRec && !aRec) return b;
  if (aRec && !bRec) return a;
  if (b.length > a.length) return b;
  return a;
}

function toolStatusFromResult(
  toolName: string,
  content: string,
): "complete" | "error" {
  return inferToolResultStatus(toolName, content);
}

function mapToolCallsFromSession(item: SessionMessage): ToolCallEvent[] {
  return (
    item.tool_calls?.map((tc, idx) => ({
      id:
        tc.id ||
        `${tc.function?.name || "tool"}-${item.timestamp ?? Date.now()}-${idx}`,
      serverId: tc.id || undefined,
      name: tc.function?.name || "tool",
      args: tc.function?.arguments || "",
      status: "complete" as const,
    })) ?? []
  );
}

function appendAssistantContent(existing: string, next: string): string {
  const a = (existing || "").trim();
  const b = (next || "").trim();
  if (!b) return existing || "";
  if (!a) return next;
  if (nfc(a) === nfc(b)) return existing;
  if (nfc(b).startsWith(nfc(a))) return next;
  if (nfc(a).endsWith(nfc(b))) return existing;
  return `${existing}\n\n${next}`;
}

export function mergeToolCallLists(
  existing: ToolCallEvent[],
  incoming: ToolCallEvent[],
): ToolCallEvent[] {
  const merged = [...existing];
  for (const tc of incoming) {
    const dup = merged.findIndex(
      (x) =>
        x.id === tc.id ||
        (tc.serverId != null && x.serverId === tc.serverId) ||
        (x.serverId != null && x.serverId === tc.id),
    );
    if (dup >= 0) {
      const prev = merged[dup];
      const mergedResult = tc.result ?? prev.result;
      const mergedName = tc.name || prev.name;
      const inferredStatus =
        mergedResult?.trim()
          ? toolStatusFromResult(mergedName, mergedResult)
          : null;
      const status =
        inferredStatus ??
        (prev.backgroundProcId && prev.status === "running"
          ? "running"
          : tc.status === "running"
            ? "running"
            : (tc.status ?? prev.status));
      merged[dup] = {
        ...prev,
        ...tc,
        status,
        args: pickRicherToolArgs(prev.args, tc.args),
        liveLabel: tc.liveLabel ?? prev.liveLabel,
        liveTechnical: tc.liveTechnical ?? prev.liveTechnical,
        result: mergedResult,
      };
    } else {
      merged.push(tc);
    }
  }
  return merged;
}

function toolCallAlreadyInSegments(
  segments: TurnSegment[],
  toolCall: ToolCallEvent,
): boolean {
  return segments.some(
    (segment) =>
      segment.kind === "tools" &&
      segment.toolCalls.some(
        (tc) =>
          tc.id === toolCall.id ||
          (toolCall.serverId != null && tc.serverId === toolCall.serverId),
      ),
  );
}

/** Acrescenta texto/tools de uma linha assistant preservando ordem cronológica. */
function mergeAssistantRowSegments(
  existing: TurnSegment[] | undefined,
  content: string,
  toolCalls: ToolCallEvent[],
): TurnSegment[] {
  let segments = [...(existing ?? [])];
  const trimmed = content.trim();

  if (trimmed) {
    const last = segments[segments.length - 1];
    if (last?.kind === "text") {
      const prev = last.content.trim();
      if (nfc(prev) === nfc(trimmed)) {
        // noop — mesma mensagem interim repetida no histórico
      } else if (nfc(trimmed).startsWith(nfc(prev))) {
        segments = [...segments.slice(0, -1), { kind: "text", content }];
      } else if (!nfc(prev).endsWith(nfc(trimmed))) {
        segments = [...segments, { kind: "text", content }];
      }
    } else {
      segments = [...segments, { kind: "text", content }];
    }
  }

  for (const toolCall of toolCalls) {
    if (!toolCallAlreadyInSegments(segments, toolCall)) {
      segments = [...segments, { kind: "tools", toolCalls: [toolCall] }];
    }
  }

  return segments;
}

function segmentsInterleaveScore(segments: TurnSegment[]): number {
  let score = segments.length;
  if (segments[0]?.kind === "tools") {
    score -= 3;
  }
  const textBlocks = segments.filter((segment) => segment.kind === "text").length;
  const toolBlocks = segments.filter((segment) => segment.kind === "tools").length;
  if (textBlocks > 1 && toolBlocks > 0) {
    score += 2;
  }
  // Reasoning intercalado é só do cliente (SSE) — a API não persiste.
  const reasoningBlocks = segments.filter(
    (segment) => segment.kind === "reasoning",
  ).length;
  if (reasoningBlocks > 0) {
    score += reasoningBlocks * 3;
  }
  return score;
}

function segmentsHaveReasoning(segments: TurnSegment[] | undefined): boolean {
  return (segments ?? []).some((segment) => segment.kind === "reasoning");
}

function segmentsSnapshotEqual(
  left: TurnSegment[] | undefined,
  right: TurnSegment[] | undefined,
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

/** Mantém "Pensou…" do cache sem descartar texto/tools que só a API tem. */
/** Segmento de raciocínio a partir do que o banco persistiu para a linha.

  Sem isto, o "Pensou" só existia enquanto o cache local do navegador
  durasse: `mapSessionMessagesToChatMessages` ignorava `item.reasoning` e um
  navegador limpo reabria a conversa sem nenhum raciocínio, apesar de o dado
  estar no banco e na API. `startedAt == endedAt` de propósito — o histórico
  não guarda a duração, e o cabeçalho cai no "Pensou" sem tempo.
*/
function reasoningSegmentFromSession(
  item: SessionMessage,
  rawIndex: number,
): ReasoningSegment | null {
  const texto = (item.reasoning ?? item.reasoning_content ?? "").trim();
  if (!texto) return null;
  const ts = Math.round((item.timestamp ?? 0) * 1000);
  return {
    kind: "reasoning",
    id: `history-reasoning-${rawIndex}`,
    content: texto,
    startedAt: ts,
    endedAt: ts,
    streaming: false,
  };
}

function injectCachedReasoningSegments(
  cachedSegs: TurnSegment[],
  mergedSegs: TurnSegment[],
): TurnSegment[] {
  if (mergedSegs.length === 0) return cachedSegs;
  const reasoning = cachedSegs.filter(
    (segment) => segment.kind === "reasoning",
  );
  if (reasoning.length === 0) return mergedSegs;
  // O raciocínio do cache vivo tem timestamps reais ("Pensou por 2s"); o do
  // histórico não guarda duração ("Pensou"). Quando os dois existem, o do
  // cache vence — o do histórico sai para não duplicar.
  const semHistorico = mergedSegs.filter(
    (segment) => segment.kind !== "reasoning",
  );
  return [...reasoning, ...semHistorico];
}

function withCachedReasoningFields(
  cached: ChatMessage,
  merged: ChatMessage,
): ChatMessage {
  const cachedSegs = cached.segments ?? [];
  const mergedSegs = merged.segments ?? [];
  const segments = segmentsHaveReasoning(cachedSegs)
    ? injectCachedReasoningSegments(cachedSegs, mergedSegs)
    : merged.segments;
  const next: ChatMessage = {
    ...merged,
    // Mantém key React do cliente — ID novo a cada poll desmontava o DOM e limpa seleção.
    id: cached.id,
    segments,
    reasoning: cached.reasoning ?? merged.reasoning,
  };
  const visible = assistantVisibleText(next);
  if (visible && visible !== (next.content || "").trim()) {
    return { ...next, content: visible };
  }
  return next;
}

/** Prefere layout intercalado do cache quando o conteúdo final coincide com a API. */
export function preferRicherAssistantTurn(
  cached: ChatMessage,
  api: ChatMessage,
): ChatMessage {
  if (cached.role !== "assistant" || api.role !== "assistant") {
    return api;
  }

  const cachedSegs = cached.segments ?? [];
  const apiSegs = api.segments ?? [];
  const cachedText = assistantVisibleText(cached);
  const apiText = assistantVisibleText(api);

  // Histórico do servidor não inclui fases "Pensou…" — nunca descartar as do cliente.
  if (
    segmentsHaveReasoning(cachedSegs) &&
    !segmentsHaveReasoning(apiSegs) &&
    cachedText.length >= apiText.length
  ) {
    return withCachedReasoningFields(cached, {
      ...api,
      ...mergeAssistantTurnTiming(cached, api),
      segments: cachedSegs,
      streamingBuffer: undefined,
      toolCalls: mergeToolCallLists(cached.toolCalls ?? [], api.toolCalls ?? []),
      content: cachedText || apiText,
    });
  }

  if (cached.turnCompletedAt != null && cachedText.length >= apiText.length) {
    const mergedSegments =
      cachedSegs.length > 0
        ? cachedSegs
        : apiSegs.length > 0
          ? apiSegs
          : cachedText
            ? commitTextSegment([], cachedText)
            : [];
    return withCachedReasoningFields(cached, {
      ...api,
      ...mergeAssistantTurnTiming(cached, api),
      segments: mergedSegments.length > 0 ? mergedSegments : undefined,
      streamingBuffer: undefined,
      toolCalls: mergeToolCallLists(cached.toolCalls ?? [], api.toolCalls ?? []),
      content: cachedText || apiText,
    });
  }

  if (
    cachedText.length > apiText.length &&
    (!apiText || cachedText.includes(apiText))
  ) {
    const mergedSegments =
      cachedSegs.length > 0
        ? cachedSegs
        : apiSegs.length > 0
          ? apiSegs
          : commitTextSegment([], cachedText);
    return withCachedReasoningFields(cached, {
      ...api,
      ...mergeAssistantTurnTiming(cached, api),
      segments: mergedSegments.length > 0 ? mergedSegments : undefined,
      streamingBuffer: cached.turnCompletedAt != null ? undefined : cached.streamingBuffer,
      toolCalls: mergeToolCallLists(cached.toolCalls ?? [], api.toolCalls ?? []),
      content: cachedText,
    });
  }

  const sameContent = nfc(cached.content || "") === nfc(api.content || "");

  if (
    cachedSegs.length > 0 &&
    (apiSegs.length === 0 ||
      (sameContent &&
        segmentsInterleaveScore(cachedSegs) > segmentsInterleaveScore(apiSegs)))
  ) {
    return withCachedReasoningFields(cached, {
      ...api,
      ...mergeAssistantTurnTiming(cached, api),
      segments: cachedSegs,
      streamingBuffer: cached.turnCompletedAt != null ? undefined : cached.streamingBuffer,
      toolCalls: mergeToolCallLists(cached.toolCalls ?? [], api.toolCalls ?? []),
      content: composeAssistantContent(cachedSegs),
    });
  }

  if (
    cachedSegs.length > 0 &&
    apiSegs.length > 0 &&
    sameContent &&
    !segmentsSnapshotEqual(cachedSegs, apiSegs) &&
    segmentsInterleaveScore(cachedSegs) > segmentsInterleaveScore(apiSegs)
  ) {
    return withCachedReasoningFields(cached, {
      ...api,
      ...mergeAssistantTurnTiming(cached, api),
      segments: cachedSegs,
      streamingBuffer: cached.turnCompletedAt != null ? undefined : cached.streamingBuffer,
      toolCalls: mergeToolCallLists(cached.toolCalls ?? [], api.toolCalls ?? []),
      content: composeAssistantContent(cachedSegs),
    });
  }

  return withCachedReasoningFields(cached, {
    ...api,
    ...mergeAssistantTurnTiming(cached, api),
  });
}

/** One assistant bubble per agent turn (matches live SSE grouping). */
export function coalesceAssistantTurns(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    const last = out[out.length - 1];
    if (
      msg.role === "assistant" &&
      last?.role === "assistant" &&
      !isDistinctAssistantTurn(last, msg.timestamp)
    ) {
      const priorSegments =
        last.segments?.length
          ? last.segments
          : last.content?.trim()
            ? ([{ kind: "text", content: last.content }] as TurnSegment[])
            : undefined;
      last.segments = mergeAssistantRowSegments(
        priorSegments,
        msg.content || "",
        msg.toolCalls ?? [],
      );
      last.toolCalls = mergeToolCallLists(
        last.toolCalls ?? [],
        msg.toolCalls ?? [],
      );
      last.content = last.segments?.length
        ? composeAssistantContent(last.segments)
        : appendAssistantContent(last.content || "", msg.content || "");
      bumpTimestamp(last, msg.timestamp);
      if (msg.turnCompletedAt != null) {
        last.turnCompletedAt = pickLatestTimestamp(
          last.turnCompletedAt,
          msg.turnCompletedAt,
        );
      }
      continue;
    }
    out.push({ ...msg });
  }
  return out;
}

export function mapSessionMessagesToChatMessages(
  raw: SessionMessage[],
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let currentAssistantIndex: number | null = null;

  for (let rawIndex = 0; rawIndex < raw.length; rawIndex += 1) {
    const item = raw[rawIndex];
    if (item.role === "user") {
      const attachments =
        item.attachments?.map((att) => ({
          id: att.id,
          name: att.name,
          kind: (/\/api\/chat\/images\//.test(att.url)
            ? "image"
            : "document") as "image" | "document",
          url: att.url,
          previewUrl: att.url,
        })) ?? undefined;
      messages.push({
        id: stableHistoryMessageId("user", rawIndex, item.timestamp),
        role: "user",
        content: item.content || "",
        timestamp: item.timestamp,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      });
      currentAssistantIndex = null;
      continue;
    }

    if (item.role === "assistant") {
      const toolCalls = mapToolCallsFromSession(item);
      const content = storedAssistantContent(item.content);
      const reasoningSeg = reasoningSegmentFromSession(item, rawIndex);
      if (!toolCalls.length && !content.trim() && !reasoningSeg) {
        continue;
      }

      const last = messages[messages.length - 1];
      if (
        last?.role === "assistant" &&
        currentAssistantIndex !== null &&
        currentAssistantIndex === messages.length - 1 &&
        !isDistinctAssistantTurn(last, item.timestamp)
      ) {
        // O raciocínio desta linha vem ANTES do conteúdo dela no turno.
        last.segments = mergeAssistantRowSegments(
          reasoningSeg
            ? [...(last.segments ?? []), reasoningSeg]
            : last.segments,
          content,
          toolCalls,
        );
        last.toolCalls = mergeToolCallLists(last.toolCalls ?? [], toolCalls);
        last.content = last.segments?.length
          ? composeAssistantContent(last.segments)
          : appendAssistantContent(last.content || "", content);
        bumpTimestamp(last, item.timestamp);
        if (typeof item.turn_tokens === "number" && item.turn_tokens > 0) {
          last.usageTokens = item.turn_tokens;
        }
        continue;
      }

      const segments = mergeAssistantRowSegments(
        reasoningSeg ? [reasoningSeg] : undefined,
        content,
        toolCalls,
      );
      messages.push({
        id: stableHistoryMessageId("assistant", rawIndex, item.timestamp),
        role: "assistant",
        content: segments.length ? composeAssistantContent(segments) : content,
        timestamp: item.timestamp,
        toolCalls,
        ...(segments.length ? { segments } : {}),
        ...(typeof item.turn_tokens === "number" && item.turn_tokens > 0
          ? { usageTokens: item.turn_tokens }
          : {}),
      });
      currentAssistantIndex = messages.length - 1;
      continue;
    }

    if (item.role === "tool") {
      const targetIndex =
        currentAssistantIndex ??
        (messages.length > 0 &&
        messages[messages.length - 1].role === "assistant"
          ? messages.length - 1
          : null);
      if (targetIndex === null) continue;
      const target = messages[targetIndex];
      if (!target || target.role !== "assistant") continue;

      const toolId =
        item.tool_call_id ||
        `${item.tool_name || "tool"}-${item.timestamp ?? Date.now()}`;
      const existing = target.toolCalls ?? [];
      const existingIdx = existing.findIndex(
        (tc) =>
          tc.id === toolId ||
          (item.tool_call_id != null && tc.serverId === item.tool_call_id),
      );
      // Steer embutido pelo backend no content do resultado — separa o texto
      // do usuário da saída real da ferramenta (ver steerMarker.ts).
      const { cleaned: toolContent, steers: extractedSteers } =
        extractSteerMessages((item.content ?? "").trim());
      const steersPatch =
        extractedSteers.length > 0
          ? {
              steers: extractedSteers.map((text) => ({
                text,
                at: item.timestamp,
              })),
            }
          : {};
      const patch: Partial<ToolCallEvent> = {
        id: toolId,
        serverId: item.tool_call_id || undefined,
        name: item.tool_name || "tool",
        ...steersPatch,
        ...(toolContent
          ? {
              result: toolContent,
              status: toolStatusFromResult(
                item.tool_name || "tool",
                toolContent,
              ),
            }
          : {}),
      };

      if (existingIdx >= 0) {
        const prev = existing[existingIdx];
        existing[existingIdx] = enrichBackgroundRunningTool({
          ...prev,
          ...patch,
          args: prev.args,
          result: toolContent || prev.result,
          status: toolContent
            ? toolStatusFromResult(item.tool_name || prev.name || "tool", toolContent)
            : prev.status,
        });
        target.toolCalls = [...existing];
      } else {
        existing.push({
          id: toolId,
          serverId: item.tool_call_id || undefined,
          name: item.tool_name || "tool",
          args: "",
          result: toolContent || undefined,
          ...steersPatch,
          status: toolContent
          ? toolStatusFromResult(item.tool_name || "tool", toolContent)
          : "complete",
        });
        target.toolCalls = [...existing];
      }

      if (target.segments?.length) {
        target.segments = target.segments.map((segment) => {
          if (segment.kind !== "tools") {
            return segment;
          }
          return {
            ...segment,
            toolCalls: segment.toolCalls.map((tc) =>
              tc.id === toolId ||
              (item.tool_call_id != null && tc.serverId === item.tool_call_id)
                ? {
                    ...tc,
                    ...patch,
                    args: tc.args,
                    result: toolContent || tc.result,
                    status: toolContent
                      ? toolStatusFromResult(
                          item.tool_name || tc.name || "tool",
                          toolContent,
                        )
                      : tc.status,
                  }
                : tc,
            ),
          };
        });
        target.content = composeAssistantContent(target.segments);
      } else {
        target.segments = (target.toolCalls ?? []).map((tc) => ({
          kind: "tools" as const,
          toolCalls: [tc],
        }));
        target.content = composeAssistantContent(target.segments);
      }
      bumpTimestamp(target, item.timestamp);
      continue;
    }
  }

  return enrichAllMessagesBackgroundTools(coalesceAssistantTurns(messages));
}

export function sameSemanticMessage(a: ChatMessage, b: ChatMessage): boolean {
  const nfc = (s: string): string => s.normalize("NFC");
  return a.role === b.role && nfc(a.content || "") === nfc(b.content || "");
}

function isPrefixHistory(
  prefixCandidate: ChatMessage[],
  fullCandidate: ChatMessage[],
): boolean {
  if (prefixCandidate.length > fullCandidate.length) return false;
  for (let i = 0; i < prefixCandidate.length; i += 1) {
    if (!sameSemanticMessage(prefixCandidate[i], fullCandidate[i])) return false;
  }
  return true;
}

/** Prefer API attachment metadata when local cache dropped blob previews. */
export function mergeMessageAttachments(
  base: ChatMessage[],
  rich: ChatMessage[],
): ChatMessage[] {
  if (rich.length === 0) return base;
  return base.map((msg, index) => {
    const other = rich[index];
    if (!other || msg.role !== other.role) return msg;
    if (!sameSemanticMessage(msg, other)) return msg;

    const localAttachments = msg.attachments ?? [];
    const apiAttachments = other.attachments ?? [];
    const attachments =
      apiAttachments.length > 0
        ? apiAttachments
        : localAttachments.length > 0
          ? localAttachments
          : undefined;
    if (!attachments?.length) return msg;
    return { ...msg, attachments };
  });
}

function reconcileMessagePair(
  cached: ChatMessage,
  api: ChatMessage,
): ChatMessage {
  let merged: ChatMessage;
  if (cached.role === "assistant" && api.role === "assistant") {
    merged = preferRicherAssistantTurn(cached, api);
  } else if (cached.role === api.role) {
    const withAttachments =
      mergeMessageAttachments([cached], [api])[0] ?? cached;
    merged = { ...withAttachments, id: cached.id };
  } else {
    merged = { ...api, id: cached.id };
  }
  return enrichMessageBackgroundTools(merged);
}

export function reconcileHistory(
  cached: ChatMessage[],
  fromApi: ChatMessage[],
): ChatMessage[] {
  if (fromApi.length === 0) return cached;
  if (cached.length === 0) return fromApi;

  // Never replace richer local history with a shorter server snapshot.
  if (cached.length > fromApi.length) {
    return cached.map((msg, index) =>
      reconcileMessagePair(msg, fromApi[index] ?? msg),
    );
  }

  // If API is temporarily stale (common right after send), keep richer local tail.
  if (cached.length >= fromApi.length && isPrefixHistory(fromApi, cached)) {
    return cached.map((msg, index) =>
      reconcileMessagePair(msg, fromApi[index] ?? msg),
    );
  }

  if (cached.length === fromApi.length) {
    return fromApi.map((apiMsg, index) =>
      reconcileMessagePair(cached[index] ?? apiMsg, apiMsg),
    );
  }

  // API mais longa: reconcilia o prefixo (preserva ids) e anexa o restante.
  return fromApi.map((apiMsg, index) =>
    index < cached.length
      ? reconcileMessagePair(cached[index] ?? apiMsg, apiMsg)
      : apiMsg,
  );
}
