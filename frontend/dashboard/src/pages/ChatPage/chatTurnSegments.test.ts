import { describe, expect, it } from "vitest";

import {
  applyAssistantSegments,
  beginAssistantToolSegment,
  collapseConsecutiveToolSegments,
  composeAssistantContent,
  flushStreamingBuffer,
} from "./chatTurnSegments";
import type { TurnSegment } from "./components/types";
import type { ToolCallEvent } from "./components/types";

const runningTool = (id: string, name: string): ToolCallEvent => ({
  id,
  name,
  args: "",
  status: "running",
});

describe("chatTurnSegments", () => {
  it("flushes streaming text before starting a tool segment", () => {
    const base = {
      segments: [],
      streamingBuffer: "Boa ideia. Vou pesquisar.",
    };
    const next = beginAssistantToolSegment(base, runningTool("t1", "browser_navigate"));

    expect(next.segments).toHaveLength(2);
    expect(next.segments?.[0]).toEqual({
      kind: "text",
      content: "Boa ideia. Vou pesquisar.",
    });
    expect(next.segments?.[1]?.kind).toBe("tools");
    expect(next.streamingBuffer).toBe("");
    expect(next.content).toBe("Boa ideia. Vou pesquisar.");
  });

  it("colapsa segmentos tools consecutivos para timeline contínua", () => {
    const segments: TurnSegment[] = [
      { kind: "tools", toolCalls: [runningTool("t1", "a")] },
      { kind: "tools", toolCalls: [runningTool("t2", "b")] },
      { kind: "text", content: "pausa" },
      { kind: "tools", toolCalls: [runningTool("t3", "c")] },
    ];
    const collapsed = collapseConsecutiveToolSegments(segments);
    expect(collapsed).toHaveLength(3);
    expect(collapsed[0]?.kind).toBe("tools");
    expect(collapsed[0]?.kind === "tools" && collapsed[0].toolCalls).toHaveLength(2);
  });

  it("interleaves committed text and tool cards", () => {
    let state = applyAssistantSegments(
      { segments: [], streamingBuffer: "" },
      [],
      "Primeiro parágrafo.",
    );
    state = beginAssistantToolSegment(state, runningTool("t1", "search"));
    state = applyAssistantSegments(state, state.segments ?? [], "Segundo parágrafo.");

    const flushed = flushStreamingBuffer(state.segments ?? [], "Segundo parágrafo.");
    expect(flushed.segments).toHaveLength(3);
    expect(composeAssistantContent(flushed.segments)).toBe(
      "Primeiro parágrafo.\n\nSegundo parágrafo.",
    );
  });
});
