import { describe, expect, it } from "vitest";
import {
  cleanThinkingText,
  isDecontextualizedThinkingText,
  isInternalModelMonologue,
  isPredominantlyEnglish,
  resolveThinkingPhase,
  splitThinkingDisplay,
} from "./thinkingContent";
import type { ChatMessage } from "./components/types";

describe("thinkingContent", () => {
  it("remove pulsos genéricos concatenados", () => {
    expect(cleanThinkingText("Analisando...Analisando...")).toBe("");
    expect(
      cleanThinkingText("Vou revisar o diff antes do commit."),
    ).toBe("Vou revisar o diff antes do commit.");
  });

  it("extrai headline e detalhe da primeira frase", () => {
    const { headline, detail } = splitThinkingDisplay(
      "Investigando quando o shimmer permanece ativo. Verifico finalizeToolCallStatus.",
    );
    expect(headline).toBe(
      "Investigando quando o shimmer permanece ativo.",
    );
    expect(detail).toContain("finalizeToolCallStatus");
  });

  it("resolve fase Explorando para tools de busca", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "t1",
          name: "grep",
          args: "{}",
          status: "running",
        },
      ],
    };
    expect(resolveThinkingPhase(msg)).toBe("Explorando o projeto");
  });

  it("rejeita fragmentos vagos do stream", () => {
    expect(isDecontextualizedThinkingText("Bastante. Vou ver o resumo.")).toBe(
      true,
    );
    expect(isDecontextualizedThinkingText("Décimo commit hoje.")).toBe(false);
    expect(
      isDecontextualizedThinkingText("Verificando status do repositório."),
    ).toBe(false);
  });

  it("não trata narração em português como monólogo interno", () => {
    expect(isInternalModelMonologue("Vou ver o que tem dentro.")).toBe(false);
    expect(
      isInternalModelMonologue("Só tem o `.super-notepad/` untracked, vou listar."),
    ).toBe(false);
    expect(
      isInternalModelMonologue("Oi, Chefe! Em que posso te ajudar?"),
    ).toBe(false);
    expect(
      isInternalModelMonologue("Tudo ótimo, obrigado! E com você?"),
    ).toBe(false);
    expect(
      isInternalModelMonologue(
        "Let me check the git status for this repository.",
      ),
    ).toBe(true);
  });

  it("filtra raciocínio em inglês comum", () => {
    expect(
      isPredominantlyEnglish("Investigating the bitcoin price from the API."),
    ).toBe(true);
    expect(
      isPredominantlyEnglish("Searching for the latest price on CoinGecko."),
    ).toBe(true);
    expect(
      isPredominantlyEnglish("The user is asking about the current BTC price."),
    ).toBe(true);
    expect(isPredominantlyEnglish("Vou buscar a cotação do Bitcoin.")).toBe(
      false,
    );
  });

  it("remove linhas de status em inglês do stream", () => {
    expect(cleanThinkingText("Checking...Checking...")).toBe("");
    expect(cleanThinkingText("Thinking...")).toBe("");
  });

  it("não inventa fase sem tool em execução", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      reasoning: { content: "Pensando no problema.", streaming: true },
    };
    expect(resolveThinkingPhase(msg, { streaming: true })).toBe("");
  });
});
