import type {
  ChatMessage,
  ChatMessageAttachment,
  ToolCallEvent,
  TurnSegment,
} from "./components/types";
import { isInternalModelMonologue } from "./thinkingContent";

export function commitTextSegment(
  segments: TurnSegment[],
  text: string,
): TurnSegment[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return segments;
  }

  return [...segments, { kind: "text", content: text }];
}

export function flushStreamingBuffer(
  segments: TurnSegment[],
  streamingBuffer: string,
): { segments: TurnSegment[]; streamingBuffer: string } {
  if (!streamingBuffer.trim()) {
    return { segments, streamingBuffer: "" };
  }

  if (isInternalModelMonologue(streamingBuffer)) {
    return { segments, streamingBuffer: "" };
  }

  return {
    segments: commitTextSegment(segments, streamingBuffer),
    streamingBuffer: "",
  };
}

export function appendToolSegment(
  segments: TurnSegment[],
  toolCall: ToolCallEvent,
): TurnSegment[] {
  return [...segments, { kind: "tools", toolCalls: [toolCall] }];
}

export function flattenTurnSegments(segments: TurnSegment[]): {
  content: string;
  toolCalls: ToolCallEvent[];
  attachments: ChatMessageAttachment[];
} {
  const texts: string[] = [];
  const toolCalls: ToolCallEvent[] = [];
  const attachments: ChatMessageAttachment[] = [];

  for (const segment of segments) {
    if (segment.kind === "text" && segment.content.trim()) {
      texts.push(segment.content);
    } else if (segment.kind === "tools") {
      toolCalls.push(...segment.toolCalls);
    } else if (segment.kind === "attachments") {
      attachments.push(...segment.attachments);
    }
  }

  return {
    content: texts.join("\n\n"),
    toolCalls,
    attachments,
  };
}

/** Funde segmentos `tools` consecutivos para manter o rail da timeline contínuo. */
export function collapseConsecutiveToolSegments(
  segments: TurnSegment[],
): TurnSegment[] {
  const out: TurnSegment[] = [];

  for (const segment of segments) {
    const last = out[out.length - 1];
    if (
      segment.kind === "tools" &&
      last?.kind === "tools" &&
      segment.toolCalls.length > 0
    ) {
      out[out.length - 1] = {
        kind: "tools",
        toolCalls: [...last.toolCalls, ...segment.toolCalls],
      };
      continue;
    }
    out.push(segment);
  }

  return out;
}

export function composeAssistantContent(
  segments: TurnSegment[],
  streamingBuffer = "",
): string {
  const flat = flattenTurnSegments(segments);
  const parts = [flat.content.trim(), streamingBuffer.trim()].filter(Boolean);
  return parts.join(parts.length > 1 ? "\n\n" : "");
}

/** Best-effort visible assistant text from segments, buffer, or flat content. */
export function assistantVisibleText(
  msg: Pick<ChatMessage, "content" | "segments" | "streamingBuffer">,
): string {
  const fromLayout = composeAssistantContent(
    msg.segments ?? [],
    msg.streamingBuffer ?? "",
  ).trim();
  if (fromLayout) return fromLayout;
  return (msg.content ?? "").trim();
}

export function applyAssistantSegments(
  msg: {
    segments?: TurnSegment[];
    streamingBuffer?: string;
    attachments?: ChatMessageAttachment[];
  },
  segments: TurnSegment[],
  streamingBuffer = "",
): Pick<ChatMessage, "segments" | "streamingBuffer" | "content" | "toolCalls" | "attachments"> {
  const flat = flattenTurnSegments(segments);

  return {
    segments,
    streamingBuffer,
    content: composeAssistantContent(segments, streamingBuffer),
    toolCalls: flat.toolCalls,
    ...(flat.attachments.length > 0 || msg.attachments?.length
      ? {
        attachments:
          flat.attachments.length > 0
            ? flat.attachments
            : msg.attachments,
      }
      : {}),
  };
}

export function beginAssistantToolSegment(
  msg: {
    segments?: TurnSegment[];
    streamingBuffer?: string;
    attachments?: ChatMessageAttachment[];
  },
  toolCall: ToolCallEvent,
): Pick<ChatMessage, "segments" | "streamingBuffer" | "content" | "toolCalls" | "attachments"> {
  const flushed = flushStreamingBuffer(msg.segments ?? [], msg.streamingBuffer ?? "");
  const segments = appendToolSegment(flushed.segments, toolCall);

  return applyAssistantSegments(msg, segments, "");
}
