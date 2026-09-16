import { describe, expect, it } from "vitest";
import { buildDisplaySegments } from "./chatDisplaySegments";
import type { ChatMessage } from "./components/types";

describe("buildDisplaySegments", () => {
  it("inclui streamingBuffer mesmo quando o turno não está live", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "Vou listar os arquivos do projeto.",
      streamingBuffer: "Vou listar os arquivos do projeto.",
      segments: [
        {
          kind: "tools",
          toolCalls: [
            {
              id: "tc-1",
              name: "terminal",
              args: "{}",
              status: "running",
            },
          ],
        },
      ],
    };

    const segments = buildDisplaySegments(msg);
    expect(segments.map((segment) => segment.kind)).toEqual(["tools", "text"]);
    const tail = segments[1];
    expect(tail?.kind).toBe("text");
    if (tail?.kind === "text") {
      expect(tail.content).toBe("Vou listar os arquivos do projeto.");
    }
  });

  it("retorna vazio sem segmentos nem buffer", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      streamingBuffer: "",
    };
    expect(buildDisplaySegments(msg)).toEqual([]);
  });

  it("mostra o buffer ao vivo mesmo quando parece monólogo interno (evita piscar; o corte real acontece no flush)", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      streamingBuffer:
        "Let me load the sn-git-workflow skill since it's relevant.",
      segments: [],
    };
    const segments = buildDisplaySegments(msg);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe("text");
  });

  it("não duplica quando buffer já está totalmente commitado", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "Vou listar",
      streamingBuffer: "Vou listar",
      segments: [
        {
          kind: "tools",
          toolCalls: [
            {
              id: "tc-1",
              name: "terminal",
              args: "{}",
              status: "running",
            },
          ],
        },
        { kind: "text", content: "Vou listar" },
      ],
    };

    const segments = buildDisplaySegments(msg);
    const textSegments = segments.filter((s) => s.kind === "text");
    expect(textSegments).toHaveLength(1);
    expect(textSegments[0]?.kind).toBe("text");
    if (textSegments[0]?.kind === "text") {
      expect(textSegments[0].content).toBe("Vou listar");
    }
  });

  it("appende só o delta quando buffer estende texto commitado", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "Vou listar os arquivos.",
      streamingBuffer: "Vou listar os arquivos.",
      segments: [{ kind: "text", content: "Vou listar" }],
    };

    const segments = buildDisplaySegments(msg);
    expect(segments.map((s) => s.kind)).toEqual(["text", "text"]);
    const tail = segments[1];
    expect(tail?.kind).toBe("text");
    if (tail?.kind === "text") {
      expect(tail.content).toBe(" os arquivos.");
    }
  });
});
