import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeWindow,
  desktopOS,
  isDesktopApp,
  minimizeWindow,
  startWindowDrag,
  toggleWindowMaximize,
} from "@/lib/desktopNotifications";

type Invoke = ReturnType<typeof vi.fn>;

function mountDesktopBridge(): Invoke {
  const invoke = vi.fn().mockResolvedValue(undefined);
  (window as unknown as Record<string, unknown>).__TAURI__ = { core: { invoke } };
  return invoke;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).__TAURI__;
  document.documentElement.classList.remove("sn-os-win", "sn-os-mac", "sn-os-linux");
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

describe("controles de janela", () => {
  it("são no-op no navegador (sem ponte)", () => {
    // Nenhum destes deve lançar quando não há `__TAURI__`.
    expect(() => {
      startWindowDrag();
      toggleWindowMaximize();
      minimizeWindow();
      closeWindow();
    }).not.toThrow();
  });

  it("chamam o comando Rust correspondente no app desktop", () => {
    const invoke = mountDesktopBridge();

    startWindowDrag();
    toggleWindowMaximize();
    minimizeWindow();
    closeWindow();

    expect(invoke).toHaveBeenCalledWith("start_window_drag");
    expect(invoke).toHaveBeenCalledWith("toggle_window_maximize");
    expect(invoke).toHaveBeenCalledWith("minimize_window");
    expect(invoke).toHaveBeenCalledWith("close_window");
  });
});

describe("plataforma", () => {
  it("é null no navegador", () => {
    expect(desktopOS()).toBeNull();
  });

  it("lê a classe sn-os-* no app desktop", () => {
    mountDesktopBridge();
    document.documentElement.classList.add("sn-os-win");
    expect(desktopOS()).toBe("win");
  });
});
