export type ComposerRunMode = "inicio" | "code" | "automatico";

export interface ComposerRunModeOption {
  id: ComposerRunMode;
  label: string;
}

export const COMPOSER_RUN_MODES: readonly ComposerRunModeOption[] = [
  {
    id: "inicio",
    label: "Chat",
  },
  {
    id: "code",
    label: "Code",
  },
  {
    id: "automatico",
    label: "Automático",
  },
] as const;

export function normalizeComposerRunMode(
  mode: string | null | undefined,
): ComposerRunMode {
  if (mode === "code") return "code";
  if (mode === "automatico") return "automatico";
  return "inicio";
}

const RUN_MODE_LABELS: Record<ComposerRunMode, string> = {
  // Valor interno "inicio" é imutável; só o rótulo visível virou "Chat".
  inicio: "Chat",
  code: "Code",
  automatico: "Automático",
};

export function runModeLabel(mode: string | null | undefined): string {
  return RUN_MODE_LABELS[normalizeComposerRunMode(mode)];
}

/**
 * Persistência client-only: o backend não guarda `run_mode` — ausência do
 * campo é comportamento antigo. Guardamos um default GLOBAL em localStorage e,
 * quando há sessão, um valor POR CONVERSA em sessionStorage. O por-sessão
 * ganha do global na hora de carregar.
 */
const RUN_MODE_GLOBAL_KEY = "supernotepad:run-mode";

function sessionKey(sessionId: string): string {
  return `supernotepad:run-mode:${sessionId}`;
}

export function loadRunMode(sessionId?: string | null): ComposerRunMode {
  try {
    const sid = sessionId?.trim();
    if (sid) {
      const perSession = window.sessionStorage.getItem(sessionKey(sid));
      if (perSession) return normalizeComposerRunMode(perSession);
    }
    const global = window.localStorage.getItem(RUN_MODE_GLOBAL_KEY);
    if (global) return normalizeComposerRunMode(global);
  } catch {
    /* storage indisponível — cai no default */
  }
  return "inicio";
}

/**
 * Modo explícito POR CONVERSA (só o sessionStorage da sessão; `null` se não
 * houver). Diferente de `loadRunMode`, NÃO cai no default global — é o que a
 * sidebar usa para bucketizar uma conversa sem seguir a aba ativa.
 */
/**
 * Grava o modo APENAS por-conversa (sessionStorage), sem tocar no default
 * global — usado quando um chat nasce com um modo fixo (ex.: o chat de uma nota
 * abre em "inicio") sem mudar a preferência global do usuário.
 */
export function saveSessionRunModeOnly(
  sessionId: string,
  mode: ComposerRunMode,
): void {
  try {
    const sid = sessionId?.trim();
    if (sid) {
      window.sessionStorage.setItem(
        sessionKey(sid),
        normalizeComposerRunMode(mode),
      );
    }
  } catch {
    /* storage indisponível */
  }
}

export function loadSessionRunMode(
  sessionId?: string | null,
): ComposerRunMode | null {
  try {
    const sid = sessionId?.trim();
    if (sid) {
      const perSession = window.sessionStorage.getItem(sessionKey(sid));
      if (perSession) return normalizeComposerRunMode(perSession);
    }
  } catch {
    /* storage indisponível */
  }
  return null;
}

export function saveRunMode(
  mode: ComposerRunMode,
  sessionId?: string | null,
): void {
  const normalized = normalizeComposerRunMode(mode);
  try {
    window.localStorage.setItem(RUN_MODE_GLOBAL_KEY, normalized);
    const sid = sessionId?.trim();
    if (sid) {
      window.sessionStorage.setItem(sessionKey(sid), normalized);
    }
  } catch {
    /* storage indisponível — segue com o valor em memória */
  }
}
