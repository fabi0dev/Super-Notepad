import type { ChatMessage } from "@/pages/ChatPage/components/types";

export interface InteractionTiming {
  startedAt: number;
  completedAt: number;
}

export function normalizeEpochMs(ts: number): number {
  return ts < 10_000_000_000 ? ts * 1000 : ts;
}

export function pickLatestTimestamp(
  a?: number,
  b?: number,
): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return normalizeEpochMs(a) >= normalizeEpochMs(b) ? a : b;
}

export function mergeAssistantTurnTiming(
  cached: ChatMessage,
  api: ChatMessage,
): Pick<ChatMessage, "timestamp" | "turnCompletedAt"> {
  return {
    timestamp: pickLatestTimestamp(cached.timestamp, api.timestamp),
    turnCompletedAt: pickLatestTimestamp(
      cached.turnCompletedAt,
      api.turnCompletedAt,
    ),
  };
}

export function formatElapsedDuration(startMs: number, endMs: number): string {
  const diffMs = Math.max(
    0,
    normalizeEpochMs(endMs) - normalizeEpochMs(startMs),
  );
  let totalSec = Math.floor(diffMs / 1000);
  if (totalSec === 0 && diffMs > 0) totalSec = 1;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

export function formatCompletionClock(
  endMs: number,
  timezone?: string,
): string {
  const date = new Date(normalizeEpochMs(endMs));
  if (Number.isNaN(date.getTime())) return "";

  const tz = timezone?.trim() || undefined;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

  return new Intl.DateTimeFormat("pt-BR", {
    ...options,
    ...(tz ? { timeZone: tz } : {}),
  }).format(date);
}

/**
 * Estimativa dos tokens GERADOS (saída) do turno, até o evento USAGE trazer o
 * número real. ~4 chars/token sobre o que o MODELO produziu: resposta,
 * raciocínio e os args das chamadas de ferramenta. NÃO conta o RESULTADO das
 * ferramentas — isso é entrada (veio da ferramenta, não do modelo) e era o que
 * inflava a estimativa acima da saída real.
 */
export function estimateTurnTokens(msg: ChatMessage): number {
  let chars = (msg.content?.length ?? 0) + (msg.reasoning?.content?.length ?? 0);
  const segs = msg.segments ?? [];
  for (const seg of segs) {
    if (seg.kind === "text" || seg.kind === "reasoning") {
      chars += seg.content?.length ?? 0;
    } else if (seg.kind === "tools") {
      for (const tc of seg.toolCalls) {
        chars += tc.args?.length ?? 0;
      }
    }
  }
  if (segs.length === 0 && msg.toolCalls?.length) {
    for (const tc of msg.toolCalls) {
      chars += tc.args?.length ?? 0;
    }
  }
  return Math.max(0, Math.round(chars / 4));
}

export function formatInteractionFooter(
  timing: InteractionTiming,
  timezone?: string,
  options?: { live?: boolean },
): string {
  const elapsed = formatElapsedDuration(timing.startedAt, timing.completedAt);
  const clockMs = options?.live ? timing.startedAt : timing.completedAt;
  const clock = formatCompletionClock(clockMs, timezone);
  if (!elapsed && !clock) return "";
  if (!clock) return elapsed;
  if (!elapsed) return clock;
  return `${elapsed} · ${clock}`;
}

function findPrecedingUserIndex(
  messages: ChatMessage[],
  assistantIndex: number,
): number {
  for (let i = assistantIndex - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

export function buildInteractionFooters(
  messages: ChatMessage[],
  options: { streaming: boolean },
): Map<number, InteractionTiming> {
  const footers = new Map<number, InteractionTiming>();

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    // Live last turn is rendered with a ticking clock instead.
    if (options.streaming && i === messages.length - 1) continue;
    if (assistantHasRunningWork(msg) && i === messages.length - 1) continue;

    const userIndex = findPrecedingUserIndex(messages, i);
    if (userIndex < 0) continue;

    // O horário de CONCLUSÃO é o que sempre garante o rodapé. Sem ele não há o
    // que mostrar.
    const completedAt = msg.turnCompletedAt ?? msg.timestamp;
    if (completedAt == null) continue;
    const endMs = normalizeEpochMs(completedAt);

    // Início = a mensagem do usuário. Se faltar, ou vier DEPOIS do fim (relógios
    // e unidades mistas — ms local vs. segundos do servidor —, ou turno sem
    // `turnCompletedAt` cujo timestamp caiu no início), clampa para não gerar
    // duração negativa. ANTES: qualquer um desses casos descartava o rodapé
    // INTEIRO (duração, horário E tokens) — era o "tempo do turno não aparece".
    const startedAt = messages[userIndex]?.timestamp;
    const startMs =
      startedAt != null ? Math.min(normalizeEpochMs(startedAt), endMs) : endMs;

    footers.set(i, { startedAt: startMs, completedAt: endMs });
  }

  return footers;
}

function toolCallsFromMessage(msg: ChatMessage): Array<{ status: string }> {
  const fromSegments: Array<{ status: string }> = [];
  for (const segment of msg.segments ?? []) {
    if (segment.kind === "tools") {
      fromSegments.push(...segment.toolCalls);
    }
  }
  if (fromSegments.length > 0) return fromSegments;
  return msg.toolCalls ?? [];
}

/** True while any tool card on the assistant message is still running. */
export function assistantHasRunningWork(msg: ChatMessage): boolean {
  if (msg.role !== "assistant") return false;
  return toolCallsFromMessage(msg).some((tc) => tc.status === "running");
}

/**
 * Footers tick while the composer stream is active OR the last assistant
 * still has running tool/background cards (e.g. "deixando rodar").
 */
export function shouldTickLiveInteractionFooter(
  messages: ChatMessage[],
  streaming: boolean,
): boolean {
  if (streaming) return true;
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant") return false;
  return assistantHasRunningWork(last);
}

/** Epoch ms when the in-flight assistant turn started (preceding user message). */
export function getLiveTurnStartedAt(
  messages: ChatMessage[],
  live: boolean,
): number | null {
  if (!live || messages.length === 0) return null;
  const lastIndex = messages.length - 1;
  if (messages[lastIndex]?.role !== "assistant") return null;
  const userIndex = findPrecedingUserIndex(messages, lastIndex);
  if (userIndex < 0) return null;
  const startedAt = messages[userIndex]?.timestamp;
  if (startedAt == null) return null;
  return normalizeEpochMs(startedAt);
}
