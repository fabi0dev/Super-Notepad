import { describe, expect, it } from "vitest";
import { shouldShowTimelineTextRow } from "./reasoningLabels";
import { isInternalModelMonologue } from "./thinkingContent";
import { flushStreamingBuffer } from "./chatTurnSegments";

describe("shouldShowTimelineTextRow", () => {
  it("mantém narração em português", () => {
    expect(shouldShowTimelineTextRow("Bastante. Vou ver o resumo.")).toBe(true);
    expect(shouldShowTimelineTextRow("Vou ver o que tem dentro.")).toBe(true);
  });

  it("mantém texto explícito", () => {
    expect(shouldShowTimelineTextRow("Décimo commit hoje.")).toBe(true);
  });

  it("oculta monólogo interno em inglês", () => {
    expect(
      shouldShowTimelineTextRow(
        "Let me load the sn-git-workflow skill since it's relevant to this task.",
      ),
    ).toBe(false);
  });
});

describe("narração pt-BR no buffer", () => {
  it("não descarta frases curtas em português antes das tools", () => {
    expect(isInternalModelMonologue("Vou ver o que tem dentro.")).toBe(false);
    const flushed = flushStreamingBuffer(
      [],
      "Só tem o diretório `.super-notepad/` como untracked. Vou ver o que tem dentro.",
    );
    expect(flushed.segments).toHaveLength(1);
    expect(flushed.segments[0]?.kind).toBe("text");
  });

  it("não descarta cumprimento curto sem acento no DONE", () => {
    const greeting = "Oi, Chefe! Em que posso te ajudar?";
    expect(isInternalModelMonologue(greeting)).toBe(false);
    expect(shouldShowTimelineTextRow(greeting)).toBe(true);
    const flushed = flushStreamingBuffer([], greeting);
    expect(flushed.segments).toEqual([{ kind: "text", content: greeting }]);
  });
});
