import { describe, expect, it } from "vitest";
import {
  WISER_FALLBACK_CHOICES,
  WISER_USER_CANCELLED,
  WISER_USER_TIMEOUT,
  buildSettledWiserState,
  ensureWiserChoices,
  normalizePendingWiserPayload,
  normalizeWiserChoices,
  shouldPersistSettledWiser,
} from "./wiserMessages";

describe("wiserMessages", () => {
  it("normaliza choices nulas ou inválidas", () => {
    expect(normalizeWiserChoices(null)).toEqual([]);
    expect(normalizeWiserChoices(undefined)).toEqual([]);
    expect(normalizeWiserChoices([" A ", "", "B"])).toEqual(["A", "B"]);
  });

  it("garante ≥2 opções", () => {
    expect(ensureWiserChoices(null)).toEqual([...WISER_FALLBACK_CHOICES]);
    expect(ensureWiserChoices(["Só uma"])).toEqual([
      "Só uma",
      WISER_FALLBACK_CHOICES[1],
    ]);
    expect(ensureWiserChoices(["A", "B", "C"])).toEqual(["A", "B", "C"]);
  });

  it("normaliza payload pendente com choices null usando fallback", () => {
    const payload = normalizePendingWiserPayload({
      sessionId: "s1",
      question: "  Escolha  ",
      choices: null,
    });
    expect(payload.choices).toEqual([...WISER_FALLBACK_CHOICES]);
    expect(payload.question).toBe("Escolha");
  });

  it("persiste card resolvido em timeout ou cancelamento", () => {
    const timeoutResult = JSON.stringify({
      question: "Qual resposta?",
      choices_offered: ["Curta", "Longa"],
      user_response: WISER_USER_TIMEOUT,
    });
    expect(shouldPersistSettledWiser(timeoutResult)).toBe(true);
    expect(buildSettledWiserState(timeoutResult)?.statusLabel).toBe(
      "Sem resposta a tempo",
    );

    const cancelResult = JSON.stringify({
      question: "Qual resposta?",
      user_response: WISER_USER_CANCELLED,
    });
    expect(shouldPersistSettledWiser(cancelResult)).toBe(true);
    expect(buildSettledWiserState(cancelResult)?.statusLabel).toBe(
      "Cancelado pelo usuário",
    );
    expect(buildSettledWiserState(cancelResult)?.choices).toEqual([
      ...WISER_FALLBACK_CHOICES,
    ]);
  });

  it("persiste o card quando o usuário respondeu, mostrando a resposta", () => {
    // Era o defeito: a resposta existia no resultado da ferramenta, gravada
    // na sessão, mas a tela descartava — e a pessoa ficava sem registro do
    // que tinha decidido.
    const answered = JSON.stringify({
      question: "Qual resposta?",
      user_response: "Opção A",
    });

    expect(shouldPersistSettledWiser(answered)).toBe(true);

    const estado = buildSettledWiserState(answered);
    expect(estado?.statusLabel).toBe("Opção A");
    expect(estado?.answered).toBe(true);
    expect(estado?.question).toBe("Qual resposta?");
  });

  it("distingue respondido de expirado/cancelado", () => {
    // A cópia difere: «o agente segue com o melhor julgamento» só vale para
    // quem NÃO respondeu.
    const expirado = JSON.stringify({ question: "q", user_response: WISER_USER_TIMEOUT });
    const cancelado = JSON.stringify({ question: "q", user_response: WISER_USER_CANCELLED });
    const respondido = JSON.stringify({ question: "q", user_response: "Opção B" });

    expect(buildSettledWiserState(expirado)?.answered).toBe(false);
    expect(buildSettledWiserState(cancelado)?.answered).toBe(false);
    expect(buildSettledWiserState(respondido)?.answered).toBe(true);
  });

  it("nada a persistir quando o wiser ainda não resolveu", () => {
    expect(shouldPersistSettledWiser(JSON.stringify({ question: "q" }))).toBe(false);
    expect(shouldPersistSettledWiser(JSON.stringify({ question: "q", user_response: "  " }))).toBe(false);
  });
});
