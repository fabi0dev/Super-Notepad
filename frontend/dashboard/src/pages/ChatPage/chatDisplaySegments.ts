import type { ChatMessage, TurnSegment } from "./components/types";

const nfc = (value: string): string => value.normalize("NFC");

function lastCommittedTextSegment(
  committed: TurnSegment[],
): string {
  for (let i = committed.length - 1; i >= 0; i -= 1) {
    const segment = committed[i];
    if (segment?.kind === "text") {
      return segment.content;
    }
  }
  return "";
}

/** Avoid duplicating prefix already committed when server sync lags behind SSE. */
export function resolveStreamingTail(
  committed: TurnSegment[],
  buffer: string,
): string {
  const trimmed = buffer.trim();
  if (!trimmed) return "";

  const lastText = lastCommittedTextSegment(committed);
  const last = nfc(lastText.trim());
  const buf = nfc(trimmed);

  if (!last) return buffer;
  if (buf === last) return "";
  if (buf.startsWith(last)) {
    return buffer.slice(lastText.length);
  }
  return buffer;
}

/** Segments for render — always includes streamingBuffer when non-empty (visibility ≠ live UX). */
export function buildDisplaySegments(msg: ChatMessage): TurnSegment[] {
  const committed = msg.segments ?? [];
  const buffer = msg.streamingBuffer ?? "";

  if (!committed.length && !buffer.trim()) {
    return [];
  }

  if (!buffer.trim()) {
    return committed;
  }

  const tail = resolveStreamingTail(committed, buffer);
  if (!tail.trim()) {
    return committed;
  }

  return [...committed, { kind: "text", content: tail }];
}
