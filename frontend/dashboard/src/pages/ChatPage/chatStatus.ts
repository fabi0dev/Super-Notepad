import { polishActivityLabel } from "@/lib/polishActivityLabel";
import { isRealToolName } from "./chatToolVisibility";

/**
 * Rótulos da pill de status sob a bolha do assistente (pt-BR).
 * Cada chave corresponde a uma fase distinta do turno — evite sinónimos
 * que competem com a timeline de ferramentas.
 */
export const CHAT_STATUS = {
  /** Modo Code: janela de planejamento antes de executar (distinta de "Pensando"). */
  planning: "Planejando…",
  /** Turno iniciou; modelo ainda não escolheu ferramenta nem texto. */
  preparing: "Analisando seu pedido…",
  /** Aguardando resposta do modelo (status do agente). */
  working: "Trabalhando…",
  /** Raciocínio estendido / tokens de thinking do modelo. */
  reasoning: "Raciocínio prolongado…",
  /** Texto da resposta a fluir no markdown. */
  writing: "Gerando resposta…",
  /** Ferramenta concluiu; modelo vai decidir o próximo passo. */
  afterTool: "Preparando próximo passo…",
  /** Anexo de imagem no envio (pré-processamento do prompt). */
  readingImage: "Lendo imagem anexada…",
  /** Anexos de documento no envio (pré-processamento do prompt). */
  readingDocuments: "Lendo documentos anexados…",
  /** STATUS genérico do backend ou fallback sem detalhe. */
  busy: "Em andamento…",
} as const;

/** Max chars for the live status pill under the assistant bubble. */
export const CHAT_STATUS_PILL_MAX = 72;

const GENERIC_CHAT_STATUSES = new Set<string>(Object.values(CHAT_STATUS));

const REASONING_PROGRESS_EVENTS = new Set([
  "reasoning.available",
  "_thinking",
]);

const REASONING_PROGRESS_TOOLS = new Set(["_thinking", "thinking"]);

export function isGenericChatStatus(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && GENERIC_CHAT_STATUSES.has(trimmed);
}

export function truncateChatStatusPill(
  text: string,
  max = CHAT_STATUS_PILL_MAX,
): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function normalizeBackendStatus(payload: string): string {
  const trimmed = payload.trim();
  if (!trimmed) return CHAT_STATUS.busy;
  const lower = trimmed.toLowerCase();
  if (lower.includes("analisando imagem")) return CHAT_STATUS.readingImage;
  if (lower.includes("extraindo document")) return CHAT_STATUS.readingDocuments;
  if (/^raciocinando/i.test(trimmed)) {
    return trimmed.replace(/^Raciocinando/i, "Trabalhando");
  }
  return trimmed;
}

export function isReasoningProgressEvent(
  eventType: string,
  toolName: string,
): boolean {
  const event = eventType.trim().toLowerCase();
  const tool = toolName.trim().toLowerCase();
  return (
    REASONING_PROGRESS_EVENTS.has(event) ||
    REASONING_PROGRESS_TOOLS.has(tool)
  );
}

export function resolveToolProgressStatus(
  toolName: string,
  preview: string,
  eventType = "",
): string {
  if (isReasoningProgressEvent(eventType, toolName)) {
    return CHAT_STATUS.reasoning;
  }
  // Ferramenta real: detalhe fica no card — pill só indica fase genérica.
  if (isRealToolName(toolName)) {
    return CHAT_STATUS.busy;
  }
  const snippet = preview.trim();
  if (snippet) {
    return truncateChatStatusPill(polishActivityLabel(snippet));
  }
  return CHAT_STATUS.busy;
}
