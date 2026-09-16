import { isReasoningProgressEvent } from "./chatStatus";
import { PLACEHOLDER_TOOL_NAME } from "./chatSse";

/** Nomes que representam raciocínio interno — não viram card de ferramenta. */
const NON_CARD_TOOL_NAMES = new Set(["_thinking", "thinking", "mark_chapter"]);

/** True quando o nome identifica uma ferramenta real (não placeholder nem thinking). */
export function isRealToolName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized || normalized === PLACEHOLDER_TOOL_NAME) return false;
  return !NON_CARD_TOOL_NAMES.has(normalized);
}

/** True quando um evento SSE deve criar ou atualizar um card na timeline. */
export function shouldCreateToolCard(
  toolName: string,
  eventType = "",
): boolean {
  if (!isRealToolName(toolName)) return false;
  if (eventType && isReasoningProgressEvent(eventType, toolName)) return false;
  return true;
}
