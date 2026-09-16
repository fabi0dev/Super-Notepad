/** Mirror of server-side stripping for cached/history user messages. */

import { isPlanExecuteUserMessage } from "@/lib/composerAgentMode";

const IMAGE_MARKER_RE = /<!--supernotepad:image:[^>]+-->/g;
const DOCUMENT_MARKER_RE = /<!--supernotepad:document:[^>]+-->/g;

const INTERNAL_IMAGE_BLOCK_RE =
  /\[(?:O usuário enviou uma imagem|The user attached an image)[\s\S]*?\]\s*/gi;

const INTERNAL_DOCUMENT_BLOCK_RE =
  /\[Internal context from attached document[\s\S]*?\]\s*/gi;

const RAG_CONTEXT_RE =
  /<\s*rag-context\s*>[\s\S]*?<\/\s*rag-context\s*>\s*/gi;

const ECO_MEETING_RE =
  /<!--\s*supernotepad:eco-meeting\s*-->[\s\S]*?<!--\s*\/supernotepad:eco-meeting\s*-->\s*/gi;

const REPLY_CONTEXT_RE = /\[O usuário está respondendo[^\]]*\]\s*/gi;

const DOC_SENT_NOTE_RE = /\[O usuário enviou um documento[^\]]*\]\s*/gi;

/** Short agent notes (skill / MCP) — no nested `]`. */
const AGENT_IMPORTANT_SHORT_RE =
  /\[(?:IMPORTANTE|IMPORTANT):\s*[^\]]*\]\s*/gi;

/**
 * Entire turn is a synthetic process/MCP notify (stdout may contain `]`).
 * PT + EN prefixes used by web_server / gateway / cli.
 */
const AGENT_IMPORTANT_SOLE_RE =
  /^\s*\[(?:IMPORTANTE|IMPORTANT):\s*(?:O processo em segundo plano|Background process|Os servidores MCP foram|MCP servers have been)[\s\S]*\]\s*$/i;

export function isInternalProcessNotification(content: string): boolean {
  return AGENT_IMPORTANT_SOLE_RE.test(content);
}

export function displayUserMessageContent(content: string): string {
  if (!content) return "";
  if (isPlanExecuteUserMessage(content)) return "";
  if (isInternalProcessNotification(content)) return "";

  return content
    .replace(INTERNAL_IMAGE_BLOCK_RE, "")
    .replace(INTERNAL_DOCUMENT_BLOCK_RE, "")
    .replace(RAG_CONTEXT_RE, "")
    .replace(ECO_MEETING_RE, "")
    .replace(REPLY_CONTEXT_RE, "")
    .replace(DOC_SENT_NOTE_RE, "")
    .replace(AGENT_IMPORTANT_SHORT_RE, "")
    .replace(IMAGE_MARKER_RE, "")
    .replace(DOCUMENT_MARKER_RE, "")
    .trim();
}
