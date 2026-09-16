import { describe, expect, it } from "vitest";
import {
  CHAT_STATUS,
  isGenericChatStatus,
  isReasoningProgressEvent,
  normalizeBackendStatus,
  resolveToolProgressStatus,
  truncateChatStatusPill,
} from "./chatStatus";

describe("truncateChatStatusPill", () => {
  it("returns short text unchanged", () => {
    expect(truncateChatStatusPill(CHAT_STATUS.preparing)).toBe(
      CHAT_STATUS.preparing,
    );
  });

  it("truncates long status lines", () => {
    const long = "A".repeat(120);
    const out = truncateChatStatusPill(long, 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("isGenericChatStatus", () => {
  it("detects built-in phase labels", () => {
    expect(isGenericChatStatus(CHAT_STATUS.writing)).toBe(true);
    expect(isGenericChatStatus("Comando no terminal — git status")).toBe(false);
  });
});

describe("normalizeBackendStatus", () => {
  it("maps vision and document preprocessing", () => {
    expect(normalizeBackendStatus("Analisando imagem…")).toBe(
      CHAT_STATUS.readingImage,
    );
    expect(normalizeBackendStatus("Extraindo documentos…")).toBe(
      CHAT_STATUS.readingDocuments,
    );
    expect(normalizeBackendStatus("")).toBe(CHAT_STATUS.busy);
  });

  it("maps legacy Raciocinando status to Trabalhando", () => {
    expect(normalizeBackendStatus("Raciocinando…")).toBe("Trabalhando…");
    expect(normalizeBackendStatus("Raciocinando… (12s)")).toBe(
      "Trabalhando… (12s)",
    );
  });
});

describe("resolveToolProgressStatus", () => {
  it("maps reasoning progress to a fixed label", () => {
    expect(
      resolveToolProgressStatus(
        "_thinking",
        "x".repeat(500),
        "reasoning.available",
      ),
    ).toBe(CHAT_STATUS.reasoning);
  });

  it("uses generic busy label for real tools (detail stays on card)", () => {
    expect(resolveToolProgressStatus("terminal", "", "tool.started")).toBe(
      CHAT_STATUS.busy,
    );
    const preview = "linha de saída ".repeat(20);
    expect(resolveToolProgressStatus("terminal", preview, "tool.started")).toBe(
      CHAT_STATUS.busy,
    );
  });

  it("shows polished preview for non-tool progress", () => {
    const out = resolveToolProgressStatus("tool", "Verificando arquivos", "");
    expect(out).toContain("Verificando");
    expect(out.length).toBeLessThanOrEqual(72);
  });
});

describe("isReasoningProgressEvent", () => {
  it("detects reasoning-only progress events", () => {
    expect(isReasoningProgressEvent("reasoning.available", "_thinking")).toBe(
      true,
    );
    expect(isReasoningProgressEvent("tool.started", "terminal")).toBe(false);
  });
});
