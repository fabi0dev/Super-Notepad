import { displayUserMessageContent } from "@/lib/chatMessageMedia";
import type { ChatMessage, ToolCallEvent } from "./components/types";
import { coalesceAssistantTurns } from "./sessionHistoryMap";

const CHAT_CACHE_PREFIX = "supernotepad:chat:messages:";

/** In-memory copy keeps blob:/data: previews alive during an active turn.
 * sessionStorage alone cannot — serializeMessagesForCache strips them. */
const liveMessagesBySession = new Map<string, ChatMessage[]>();

export function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getChatCacheKey(sessionId: string): string {
  return `${CHAT_CACHE_PREFIX}${sessionId}`;
}

function parseStoredMessages(raw: string): ChatMessage[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  const messages = parsed.map((item) => {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    const role = record.role;
    const content = record.content;
    const cachedId = typeof record.id === "string" ? record.id.trim() : "";
    const id =
      cachedId.length > 0
        ? cachedId
        : createMessageId(
            role === "assistant"
              ? "assistant"
              : role === "user"
                ? "user"
                : "system",
          );
    const toolCalls = Array.isArray(record.toolCalls)
      ? (record.toolCalls as ToolCallEvent[])
      : undefined;
    const rawContent = typeof content === "string" ? content : "";
    const roleValue = (role as ChatMessage["role"]) ?? "system";
    return {
      ...(item as ChatMessage),
      id,
      role: roleValue,
      content:
        roleValue === "user" ? displayUserMessageContent(rawContent) : rawContent,
      ...(toolCalls ? { toolCalls } : {}),
    } as ChatMessage;
  });
  return coalesceAssistantTurns(messages.filter(Boolean) as ChatMessage[]);
}

function readStoredMessages(sessionId: string): ChatMessage[] {
  try {
    const raw = window.sessionStorage.getItem(getChatCacheKey(sessionId));
    if (!raw) return [];
    return parseStoredMessages(raw);
  } catch {
    return [];
  }
}

export function readCachedMessages(sessionId: string): ChatMessage[] {
  const sid = sessionId.trim();
  if (!sid) return [];
  const live = liveMessagesBySession.get(sid);
  if (live) return live;
  return readStoredMessages(sid);
}

export function serializeMessagesForCache(messages: ChatMessage[]): ChatMessage[] {
  // Blob/data preview URLs die on reload; keep persisted API attachment URLs.
  return messages.map(({ attachments, ...rest }) => {
    if (!attachments?.length) return rest;
    const persisted = attachments
      .map((attachment) => {
        const apiUrl = attachment.url?.startsWith("/api/chat/")
          ? attachment.url
          : undefined;
        const previewUrl =
          attachment.previewUrl &&
          !attachment.previewUrl.startsWith("blob:") &&
          !attachment.previewUrl.startsWith("data:")
            ? attachment.previewUrl
            : apiUrl;
        if (!previewUrl && !apiUrl) return null;
        return {
          ...attachment,
          ...(apiUrl ? { url: apiUrl } : {}),
          ...(previewUrl ? { previewUrl } : {}),
        };
      })
      .filter((attachment): attachment is NonNullable<typeof attachment> =>
        Boolean(attachment),
      );
    return persisted.length > 0 ? { ...rest, attachments: persisted } : rest;
  });
}

export function writeCachedMessages(sessionId: string, messages: ChatMessage[]): void {
  const sid = sessionId.trim();
  if (!sid) return;
  liveMessagesBySession.set(sid, messages);
  try {
    window.sessionStorage.setItem(
      getChatCacheKey(sid),
      JSON.stringify(serializeMessagesForCache(messages)),
    );
  } catch {
    // Ignore cache quota/privacy errors.
  }
}

/** Test helper — drop in-memory rows (sessionStorage untouched unless cleared by test). */
export function clearLiveMessageCacheForTests(): void {
  liveMessagesBySession.clear();
}
