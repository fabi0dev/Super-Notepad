/**
 * Ponte com o app desktop (Tauri).
 *
 * Reúne os helpers que a página usa para falar com a janela nativa: detectar se
 * está rodando no app, arrastar/maximizar/minimizar/fechar a janela sem moldura,
 * descobrir a plataforma e persistir preferências (tema/transparência) que o
 * bootstrap do desktop lê no arranque. No navegador (sem `__TAURI__`) tudo isto
 * é inerte — cada função vira um no-op.
 */

import { fetchJSON } from "@/lib/api";

type TauriCore = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

function tauriCore(): TauriCore | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as { __TAURI__?: { core?: TauriCore } }).__TAURI__;
  return typeof bridge?.core?.invoke === "function" ? bridge.core : null;
}

/** True quando o painel está dentro do app desktop, não num navegador. */
export function isDesktopApp(): boolean {
  return tauriCore() !== null;
}

/**
 * Inicia o arraste da janela sem moldura (faixa do topo).
 *
 * A janela usa barra de título integrada (Overlay), então o arraste não é
 * nativo e `-webkit-app-region` não funciona no WKWebView. Chamamos o comando
 * Rust no `mousedown` — o WebKit assume o resto do gesto. No navegador (sem
 * `__TAURI__`) é um no-op.
 */
export function startWindowDrag(): void {
  const core = tauriCore();
  if (!core) return;
  void core.invoke("start_window_drag").catch(() => {});
}

/** Alterna maximizar/restaurar — duplo-clique na faixa de arraste. */
export function toggleWindowMaximize(): void {
  const core = tauriCore();
  if (!core) return;
  void core.invoke("toggle_window_maximize").catch(() => {});
}

/** Minimiza a janela — controle próprio (Windows/Linux, janela sem moldura). */
export function minimizeWindow(): void {
  const core = tauriCore();
  if (!core) return;
  void core.invoke("minimize_window").catch(() => {});
}

/** Fecha a janela — controle próprio (Windows/Linux, janela sem moldura). */
export function closeWindow(): void {
  const core = tauriCore();
  if (!core) return;
  void core.invoke("close_window").catch(() => {});
}

/**
 * Plataforma do app desktop: "mac" | "win" | "linux", ou `null` no navegador.
 *
 * Decide quem desenha os controles da janela — no macOS são os nativos
 * (barra Overlay); no Windows/Linux a janela é sem moldura e o app põe os
 * seus. Lê a classe `sn-os-*` posta no boot (main.tsx) e cai para o
 * `userAgent` se a classe não estiver lá.
 */
export function desktopOS(): "mac" | "win" | "linux" | null {
  if (!isDesktopApp()) return null;
  const root = typeof document !== "undefined" ? document.documentElement : null;
  if (root?.classList.contains("sn-os-win")) return "win";
  if (root?.classList.contains("sn-os-mac")) return "mac";
  if (root?.classList.contains("sn-os-linux")) return "linux";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows/i.test(ua)) return "win";
  if (/Mac|iPhone|iPad/i.test(ua)) return "mac";
  return "linux";
}

/**
 * Persiste a preferência "Fundo transparente" para a PRÓXIMA execução do app.
 *
 * No macOS o flag de transparência da janela só pode ser definido na criação,
 * então a troca não vale para a janela atual: o servidor do painel grava a
 * preferência num arquivo e o Tauri a lê no próximo arranque. Vai pelo servidor
 * (não por um comando do Tauri) para não depender de gerar permissão de IPC.
 * Só faz sentido no app desktop; no navegador é no-op.
 */
export async function persistTransparentPref(enabled: boolean): Promise<void> {
  if (!isDesktopApp()) return;
  try {
    await fetchJSON("/api/desktop/transparent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  } catch {
    // Endpoint ausente (servidor antigo) ou falha de rede — não é fatal.
  }
}

/**
 * Persiste o tema escolhido (dark/light/system) para o SPLASH do bootstrap do
 * desktop. Esse bootstrap roda numa origem sem o localStorage do painel, então
 * o servidor grava um arquivo que o Tauri lê no arranque e injeta no splash —
 * mesmo caminho da transparência. No navegador é no-op.
 */
export async function persistDesktopTheme(theme: string): Promise<void> {
  if (!isDesktopApp()) return;
  try {
    await fetchJSON("/api/desktop/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme }),
    });
  } catch {
    // Endpoint ausente/falha de rede — não é fatal (cai no prefers-color).
  }
}

/**
 * Lê a preferência "Fundo transparente" do servidor — a MESMA fonte que o Tauri
 * usa para decidir a transparência da janela no arranque. É o que casa o CSS
 * (fundo translúcido) com o estado real da janela, inclusive numa janela
 * recém-aberta (a de e-mail) cujo localStorage pode não estar sincronizado.
 * Devolve `null` fora do app desktop ou se o endpoint não responder.
 */
export async function fetchTransparentPref(): Promise<boolean | null> {
  if (!isDesktopApp()) return null;
  try {
    const data = await fetchJSON<{ enabled?: boolean }>(
      "/api/desktop/transparent",
    );
    return Boolean(data?.enabled);
  } catch {
    return null;
  }
}
