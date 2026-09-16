import { describe, expect, it } from "vitest";
import {
  COMPOSER_AGENT_MODES,
  composerPlaceholderForMode,
  isPlanExecuteUserMessage,
  normalizeComposerAgentMode,
  PLAN_EXECUTE_USER_MESSAGE,
  resolveComposerModeDisplay,
} from "./composerAgentMode";

describe("composerAgentMode", () => {
  it("normaliza modo desconhecido para agent", () => {
    expect(normalizeComposerAgentMode(undefined)).toBe("agent");
    expect(normalizeComposerAgentMode("invalid")).toBe("agent");
    expect(normalizeComposerAgentMode("plan")).toBe("plan");
  });

  it("oculta a mensagem interna de Executar plano", () => {
    expect(isPlanExecuteUserMessage(PLAN_EXECUTE_USER_MESSAGE)).toBe(true);
    expect(isPlanExecuteUserMessage("outra mensagem")).toBe(false);
  });

  it("resolve label do footer", () => {
    expect(resolveComposerModeDisplay({ agent_mode_label: "Plano" })).toBe(
      "Plano",
    );
    expect(resolveComposerModeDisplay({ agent_mode: "plan" })).toBe("Plano");
    expect(resolveComposerModeDisplay({})).toBe("Agente");
  });

  it("placeholder muda com o modo", () => {
    expect(composerPlaceholderForMode("agent")).toBe("Escreva sua mensagem…");
    expect(composerPlaceholderForMode("plan")).toBe(
      "Descreva o que quer planejar…",
    );
  });

  it("expõe duas opções de modo", () => {
    expect(COMPOSER_AGENT_MODES.map((m) => m.id)).toEqual(["agent", "plan"]);
  });
});
