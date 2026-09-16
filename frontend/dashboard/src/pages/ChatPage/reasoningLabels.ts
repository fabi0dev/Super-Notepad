import { polishActivityLabel } from "@/lib/polishActivityLabel";
import { getToolDisplayLabel } from "@/lib/toolDisplayLabel";
import { isGenericChatStatus } from "./chatStatus";
import { assistantVisibleText } from "./chatTurnSegments";
import type { ChatMessage, ToolCallEvent } from "./components/types";
import {
  isDecontextualizedThinkingText,
  isInternalModelMonologue,
  isPredominantlyEnglish,
  resolveThinkingPhase,
  splitThinkingDisplay,
} from "./thinkingContent";

const GENERIC_THINKING_PULSE =
  /^(?:pensando|analisando|avaliando|refletindo|raciocinando|processando|trabalhando)[\s.…]*$/i;

/** Fragmentos curtos do stream (ex. `O6P`) — não são texto legível. */
const CODE_FRAGMENT_RE = /^[A-Z0-9]{2,10}$/;

/** Texto visível na resposta do assistente (sem heurística de thinking). */
export function hasVisibleAssistantText(text: string): boolean {
  return Boolean(text.trim());
}

/** Texto substantivo o bastante para exibir ao utilizador. */
export function isSubstantiveThinkingText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isGenericThinkingPulse(trimmed)) return false;
  if (isPredominantlyEnglish(trimmed)) return false;
  if (CODE_FRAGMENT_RE.test(trimmed)) return false;
  if (!/\s/.test(trimmed) && !/[.!?,;:…]/.test(trimmed)) {
    if (trimmed.length < 8) return false;
    if (!/[aeiouáéíóúàèìòùâêîôûãõ]/i.test(trimmed)) return false;
  }
  return true;
}

export function shouldShowTimelineTextRow(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return !isInternalModelMonologue(trimmed);
}

export function collectToolCalls(msg: ChatMessage): ToolCallEvent[] {
  const fromSegments: ToolCallEvent[] = [];
  for (const segment of msg.segments ?? []) {
    if (segment.kind === "tools") {
      fromSegments.push(...segment.toolCalls);
    }
  }
  if (fromSegments.length > 0) return fromSegments;
  return msg.toolCalls ?? [];
}

/** Pulsos do spinner quiet-mode (`run_agent.py`) — não são raciocínio real. */
export function isGenericThinkingPulse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (isGenericChatStatus(trimmed)) return true;
  if (GENERIC_THINKING_PULSE.test(trimmed)) return true;
  return false;
}

/** Remove pulsos genéricos e monólogo interno em inglês (UI é pt-BR). */
export function sanitizeThinkingContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (isGenericThinkingPulse(trimmed)) return "";
  if (isInternalModelMonologue(trimmed)) return "";

  const withoutGenericRuns = trimmed
    .replace(
      /(?:Pensando|Analisando|Avaliando|Refletindo|Raciocinando|Processando|Trabalhando)[\s.…]+/gi,
      "",
    )
    .trim();
  if (!withoutGenericRuns) return "";
  if (isGenericThinkingPulse(withoutGenericRuns)) return "";
  if (isInternalModelMonologue(withoutGenericRuns)) return "";

  const keptLines = withoutGenericRuns
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !isGenericThinkingPulse(line) &&
        !isInternalModelMonologue(line) &&
        isSubstantiveThinkingText(line),
    );
  if (keptLines.length === 0) return "";
  return keptLines.join("\n");
}

export function hasVisibleThinkingContent(content: string): boolean {
  return Boolean(sanitizeThinkingContent(content).trim());
}

/**
 * Normaliza texto para comparação near-dup entre reasoning e resposta.
 * Ignora markdown leve (code fences, backticks, ênfase) e colapsa whitespace.
 */
export function normalizeComparableText(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~#>|[\]()\\]/g, " ")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Providers por vezes espelham o rascunho da resposta em `reasoning*`.
 * Nesse caso o bloco "Pensou" é redundante — ocultar.
 */
export function isReasoningNearDuplicateOfAssistant(
  reasoning: string,
  assistantText: string,
): boolean {
  const r = normalizeComparableText(sanitizeThinkingContent(reasoning));
  const a = normalizeComparableText(assistantText);
  if (!r || !a) return false;
  if (r === a) return true;

  const shorter = r.length <= a.length ? r : a;
  const longer = r.length <= a.length ? a : r;
  if (shorter.length >= 24 && longer.includes(shorter)) {
    const ratio = shorter.length / longer.length;
    if (ratio >= 0.72) return true;
  }

  const rTokens = new Set(r.split(" ").filter((token) => token.length > 1));
  const aTokens = new Set(a.split(" ").filter((token) => token.length > 1));
  if (rTokens.size < 4 || aTokens.size < 4) return false;
  let intersection = 0;
  for (const token of rTokens) {
    if (aTokens.has(token)) intersection += 1;
  }
  const union = rTokens.size + aTokens.size - intersection;
  return union > 0 && intersection / union >= 0.85;
}

function pickSpecificLabel(...candidates: Array<string | undefined>): string {
  for (const raw of candidates) {
    const trimmed = (raw || "").trim();
    if (!trimmed || !isSubstantiveThinkingText(trimmed)) continue;
    if (isInternalModelMonologue(trimmed)) continue;
    return polishActivityLabel(trimmed);
  }
  return "";
}

function latestToolContextLabel(msg: ChatMessage): string {
  const tools = collectToolCalls(msg);
  const running = tools.filter((tc) => tc.status === "running");
  if (running.length > 0) {
    const label = running[running.length - 1]?.liveLabel?.trim();
    if (label && isSubstantiveThinkingText(label)) {
      return polishActivityLabel(label);
    }
    const name = running[running.length - 1]?.name;
    if (name) return getToolDisplayLabel(name);
  }

  for (let i = tools.length - 1; i >= 0; i -= 1) {
    const label = tools[i]?.liveLabel?.trim();
    if (label && isSubstantiveThinkingText(label)) {
      return polishActivityLabel(label);
    }
  }

  const last = tools[tools.length - 1];
  return last ? getToolDisplayLabel(last.name) : "";
}

function enrichThinkingPresentation(
  headline: string,
  detail: string,
  toolContext: string,
  fullSanitized: string,
): { headline: string; detail: string } {
  const combinedDetail = [headline, detail, fullSanitized]
    .filter((part, index, arr) => part.trim() && arr.indexOf(part) === index)
    .join("\n")
    .trim();

  const vagueHeadline =
    !headline.trim() || isDecontextualizedThinkingText(headline);

  if (vagueHeadline && toolContext) {
    const reasoningDetail =
      combinedDetail && combinedDetail !== toolContext ? combinedDetail : detail;
    return {
      headline: toolContext,
      detail: reasoningDetail,
    };
  }

  if (vagueHeadline) {
    return { headline: "", detail: combinedDetail };
  }

  return {
    headline,
    detail: detail || (combinedDetail !== headline ? combinedDetail : ""),
  };
}

function phaseAddsInformation(phase: string, headline: string): boolean {
  if (!phase || !headline) return false;
  const p = phase.toLowerCase();
  const h = headline.toLowerCase();
  if (p === h || h.startsWith(p)) return false;
  if (p === "planejando" || p === "raciocinando") return false;
  return true;
}

export interface ResolvedLiveActivity {
  headline: string;
  phase: string;
  detail: string;
  /** @deprecated use headline */
  label: string;
  shimmer: boolean;
  /** @deprecated use detail */
  thinkingContent: string;
  showPlanning: boolean;
}

/** Rótulo vivo do turno — só conteúdo real; sem rótulos fictícios de espera. */
export function resolveLiveActivity(
  msg: ChatMessage,
  options?: { live?: boolean; showReasoning?: boolean },
): ResolvedLiveActivity {
  const live = options?.live ?? false;
  const showReasoning = options?.showReasoning !== false;
  const toolCalls = collectToolCalls(msg);
  const hasRunningTool = toolCalls.some((tc) => tc.status === "running");
  const sanitized = sanitizeThinkingContent(msg.reasoning?.content ?? "");
  const hasRealReasoning = sanitized.length > 0;
  const split = splitThinkingDisplay(sanitized);
  const toolContext = latestToolContextLabel(msg);
  const enriched = enrichThinkingPresentation(
    split.headline,
    split.detail,
    toolContext,
    sanitized,
  );

  const headline = pickSpecificLabel(
    enriched.headline,
    msg.reasoning?.label,
    toolContext,
  );

  const detail = enriched.detail;

  const rawPhase =
    hasRealReasoning && (hasRunningTool || toolContext)
      ? resolveThinkingPhase(msg, {
          streaming: live && Boolean(msg.reasoning?.streaming),
        })
      : "";
  const phase =
    phaseAddsInformation(rawPhase, headline) &&
    rawPhase.trim().toLowerCase() !== headline.trim().toLowerCase()
      ? rawPhase
      : "";

  const shimmer = live && Boolean(msg.reasoning?.streaming) && hasRealReasoning;

  const resolvedHeadline =
    headline ||
    (isSubstantiveThinkingText(detail.split("\n")[0] ?? "")
      ? detail.split("\n")[0]?.trim() ?? ""
      : "");

  // Header visual é fixo ("Pensando" / "Pensou por Ns"); manter após o turno.
  const isActiveReasoning =
    live &&
    Boolean(msg.reasoning?.streaming) &&
    msg.reasoning?.endedAt == null &&
    (hasRealReasoning || !(msg.reasoning?.content ?? "").trim());
  // Não mostrar "Pensou" se o conteúdo for só um espelho da resposta final.
  const isDuplicateAnswer =
    !isActiveReasoning &&
    isReasoningNearDuplicateOfAssistant(
      sanitized,
      assistantVisibleText(msg),
    );
  const showPlanning =
    showReasoning &&
    !isDuplicateAnswer &&
    (hasRealReasoning || isActiveReasoning);

  return {
    headline: resolvedHeadline,
    phase,
    detail,
    label: resolvedHeadline,
    shimmer,
    thinkingContent: detail || sanitized,
    showPlanning,
  };
}
