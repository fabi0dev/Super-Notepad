import { describe, expect, it } from "vitest";
import {
  isGenericThinkingPulse,
  isReasoningNearDuplicateOfAssistant,
  isSubstantiveThinkingText,
  resolveLiveActivity,
  sanitizeThinkingContent,
} from "./reasoningLabels";
import { CHAT_STATUS } from "./chatStatus";
import type { ChatMessage } from "./components/types";

describe("reasoningLabels", () => {
  it("detecta pulsos genéricos do spinner", () => {
    expect(isGenericThinkingPulse("Analisando...")).toBe(true);
    expect(isGenericThinkingPulse("Analisando…")).toBe(true);
    expect(isGenericThinkingPulse("Raciocinando...")).toBe(true);
    expect(isGenericThinkingPulse(CHAT_STATUS.preparing)).toBe(true);
    expect(isGenericThinkingPulse("Verificando status do git")).toBe(false);
  });

  it("remove acumulação repetida de Analisando", () => {
    expect(sanitizeThinkingContent("Analisando...Analisando...")).toBe("");
    expect(
      sanitizeThinkingContent(
        "Vou revisar o diff antes do commit.",
      ),
    ).toBe("Vou revisar o diff antes do commit.");
  });

  it("oculta monólogo interno em inglês do corpo do thinking", () => {
    expect(
      sanitizeThinkingContent(
        "Let me check the file state before writing.",
      ),
    ).toBe("");
    expect(
      sanitizeThinkingContent(
        "The user wants me to update the gitignore.",
      ),
    ).toBe("");
    expect(
      sanitizeThinkingContent(
        "Searching for the bitcoin price via CoinGecko API.",
      ),
    ).toBe("");
    expect(
      sanitizeThinkingContent(
        "I'm in plan mode, so I can only use read-only tools. Let me explore the project first.",
      ),
    ).toBe("");
    expect(
      sanitizeThinkingContent(
        "Vou adicionar `.claude/` ao `.gitignore`.",
      ),
    ).toContain("gitignore");
    expect(
      sanitizeThinkingContent(
        "Vou explorar o projeto para entender a estrutura antes de montar o plano.",
      ),
    ).toContain("explorar");
  });

  it("detecta reasoning espelhado na resposta final", () => {
    const answer =
      "Alterações: novo feature flag `app_show_missions_flight_manager` e uso condicional do campo Missão no FlightDataDBETab.";
    const reasoning =
      "Alterações: novo feature flag app_show_missions_flight_manager e uso condicional do campo Missão no FlightDataDBETab.";
    expect(isReasoningNearDuplicateOfAssistant(reasoning, answer)).toBe(true);
    expect(
      isReasoningNearDuplicateOfAssistant(
        "Vou revisar o diff e depois fazer o commit.",
        answer,
      ),
    ).toBe(false);
  });

  it("não mostra planning só com pulso genérico ou status fictício", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      statusText: CHAT_STATUS.reasoning,
      reasoning: {
        content: "",
        startedAt: Date.now(),
        streaming: false,
      },
    };
    const activity = resolveLiveActivity(msg, { live: true });
    expect(activity.showPlanning).toBe(false);
    expect(activity.headline).toBe("");
    expect(activity.phase).toBe("");
    expect(activity.shimmer).toBe(false);
  });

  it("mostra planning apenas com raciocínio real", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      reasoning: {
        content: "Investigando o shimmer. Verifico finalizeToolCallStatus.",
        streaming: true,
        startedAt: Date.now(),
      },
    };
    const activity = resolveLiveActivity(msg, { live: true });
    expect(activity.showPlanning).toBe(true);
    expect(activity.headline).toBe("Investigando o shimmer.");
    expect(activity.phase).toBe("");
    expect(activity.shimmer).toBe(true);
  });

  it("mostra fase contextual com raciocínio real e tool em execução", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      reasoning: {
        content: "Investigando o shimmer. Verifico finalizeToolCallStatus.",
        streaming: true,
        startedAt: Date.now(),
      },
      toolCalls: [
        {
          id: "t1",
          name: "grep",
          args: "{}",
          status: "running",
          liveLabel: "Buscando shimmer",
        },
      ],
    };
    const activity = resolveLiveActivity(msg, { live: true });
    expect(activity.showPlanning).toBe(true);
    expect(activity.headline).toBe("Investigando o shimmer.");
    expect(activity.phase).toBe("Buscando shimmer");
    expect(activity.shimmer).toBe(true);
  });

  it("rejeita fragmentos curtos do stream como O6P", () => {
    expect(isSubstantiveThinkingText("O6P")).toBe(false);
    expect(sanitizeThinkingContent("O6P")).toBe("");
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      reasoning: { content: "O6P", streaming: true, startedAt: Date.now() },
    };
    const activity = resolveLiveActivity(msg, { live: true });
    expect(activity.showPlanning).toBe(false);
    expect(activity.headline).toBe("");
  });

  it("usa contexto da tool quando o raciocínio é vago", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      reasoning: {
        content: "Bastante. Vou ver o resumo.",
        streaming: true,
        startedAt: Date.now(),
      },
      toolCalls: [
        {
          id: "t1",
          name: "terminal",
          args: "{}",
          status: "running",
          liveLabel: "Verificando status do repositório",
        },
      ],
    };
    const activity = resolveLiveActivity(msg, { live: true, showReasoning: true });
    expect(activity.showPlanning).toBe(true);
    expect(activity.headline).toBe("Verificando status do repositório");
    expect(activity.detail).toContain("Bastante");
  });

  it("não pulsa planejamento só por status genérico sem tool ativa", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      statusText: CHAT_STATUS.preparing,
      toolCalls: [
        {
          id: "t1",
          name: "read_file",
          args: "{}",
          status: "complete",
          result: "ok",
        },
      ],
    };
    const activity = resolveLiveActivity(msg, { live: true });
    expect(activity.shimmer).toBe(false);
    expect(activity.showPlanning).toBe(false);
  });

  it("mantém planejamento após o turno quando há raciocínio real", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "Pronto.",
      reasoning: {
        content: "Vou verificar o status do repositório antes de responder.",
        streaming: false,
        startedAt: Date.now() - 5000,
        endedAt: Date.now(),
      },
    };
    const activity = resolveLiveActivity(msg, {
      live: false,
      showReasoning: true,
    });
    expect(activity.showPlanning).toBe(true);
    expect(activity.shimmer).toBe(false);
    expect(activity.headline.length).toBeGreaterThan(0);
  });

  it("oculta planning quando reasoning é cópia da resposta", () => {
    const body =
      "Commit 54ad640a feito e enviado para origin/staging.\n\n- featureFlags.ts — novo flag app_show_missions_flight_manager\n- FlightDataDBETab/index.tsx — campo Missão condicionado ao flag\n\nPush concluído.";
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: body,
      reasoning: {
        content: body,
        streaming: false,
        startedAt: Date.now() - 2000,
        endedAt: Date.now(),
      },
    };
    const activity = resolveLiveActivity(msg, {
      live: false,
      showReasoning: true,
    });
    expect(activity.showPlanning).toBe(false);
  });

  it("oculta planejamento quando showReasoning é false", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "Pronto.",
      reasoning: {
        content: "Vou verificar o status do repositório antes de responder.",
        streaming: false,
        startedAt: Date.now() - 5000,
        endedAt: Date.now(),
      },
    };
    const activity = resolveLiveActivity(msg, {
      live: false,
      showReasoning: false,
    });
    expect(activity.showPlanning).toBe(false);
  });

  it("não mantém planejamento após o turno sem raciocínio visível", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "Pronto.",
      reasoning: {
        content: "Thinking about the next step.",
        streaming: false,
        startedAt: Date.now() - 126_000,
        endedAt: Date.now(),
      },
    };
    const activity = resolveLiveActivity(msg, {
      live: false,
      showReasoning: true,
    });
    expect(activity.showPlanning).toBe(false);
  });
});
