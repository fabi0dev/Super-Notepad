import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDesktopNotificationsForTests,
  isDesktopApp,
  notifyApprovalRequested,
  notifyQuestionAsked,
  readNotifyOnApprovalFromConfig,
  readNotifyOnCompleteFromConfig,
} from "@/lib/desktopNotifications";

type Invoke = ReturnType<typeof vi.fn>;

function mountDesktopBridge(): Invoke {
  const invoke = vi.fn().mockResolvedValue(undefined);
  (window as unknown as Record<string, unknown>).__TAURI__ = { core: { invoke } };
  return invoke;
}

function setPageActive(active: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (active ? "visible" : "hidden"),
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(active);
}

beforeEach(() => {
  __resetDesktopNotificationsForTests();
  delete (window as unknown as Record<string, unknown>).__TAURI__;
  setPageActive(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).__TAURI__;
});

describe("detecção do app", () => {
  it("fica inerte no navegador", () => {
    expect(isDesktopApp()).toBe(false);
  });

  it("reconhece a ponte do Tauri", () => {
    mountDesktopBridge();
    expect(isDesktopApp()).toBe(true);
  });
});

describe("envio", () => {
  it("nunca chama o IPC no navegador", () => {
    const invoke = vi.fn();
    notifyApprovalRequested();
    notifyQuestionAsked("Prossigo?");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("conteúdo", () => {
  it("agrupa aprovação e pergunta sob a mesma tag", () => {
    const invoke = mountDesktopBridge();

    notifyApprovalRequested("Aprovar `rm -rf build`", "k1");
    notifyQuestionAsked("Prossigo com a migração?", "k2");

    expect(invoke).toHaveBeenNthCalledWith(1, "notify", {
      request: expect.objectContaining({
        tag: "atencao",
        // O detalhe é achatado (markdown → texto puro): as crases somem, senão
        // vazariam cruas para o banner do SO.
        body: "Aprovar rm -rf build",
      }),
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "notify", {
      request: expect.objectContaining({
        tag: "atencao",
        body: "Prossigo com a migração?",
      }),
    });
  });

  it("não deixa aprovação e pergunta se engolirem", () => {
    const invoke = mountDesktopBridge();

    // Antes as duas dividiam a chave de dedup: a segunda sumia.
    notifyApprovalRequested("aprova isto", "k1");
    notifyQuestionAsked("e isto?", "k2");

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("ignora pergunta vazia", () => {
    const invoke = mountDesktopBridge();
    notifyQuestionAsked("   ");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("repete a mesma pergunta pendente uma vez só", () => {
    const invoke = mountDesktopBridge();

    notifyQuestionAsked("Prossigo?", "req-1");
    notifyQuestionAsked("Prossigo?", "req-1");

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("config", () => {
  it("liga por padrão quando a chave não existe", () => {
    expect(readNotifyOnCompleteFromConfig({})).toBe(true);
    expect(readNotifyOnApprovalFromConfig(null)).toBe(true);
  });

  it("respeita o desligamento explícito", () => {
    const config = { dashboard: { notifications: { on_complete: false, on_approval: false } } };
    expect(readNotifyOnCompleteFromConfig(config)).toBe(false);
    expect(readNotifyOnApprovalFromConfig(config)).toBe(false);
  });

  it("não confunde as duas chaves", () => {
    const config = { dashboard: { notifications: { on_complete: false } } };
    expect(readNotifyOnCompleteFromConfig(config)).toBe(false);
    expect(readNotifyOnApprovalFromConfig(config)).toBe(true);
  });
});
