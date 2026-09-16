/** Paridade com Ink TUI (`statusBarHelpers` / `ComposerFooter` / `domain/paths`). */

const HOME_UNIX_RE = /^\/(?:Users|home)\/[^/]+/;

export interface ComposerWorkspaceDisplay {
  dirName: string;
  branch: string | null;
  modified: number;
  untracked: number;
  /** Commits ahead of upstream (unpushed). */
  ahead: number;
  /** Commits behind upstream. */
  behind: number;
  fullPath: string;
}

/** Último segmento do cwd para o rodapé compacto. */
export function cwdDirName(cwd: string): string {
  const p = cwd.replace(/\/+$/, "").trim();
  if (!p) return "";
  if (p === "~") return "~";
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function hasGitActivity(modified = 0, untracked = 0): boolean {
  return modified > 0 || untracked > 0;
}

export function normalizeGitCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** Converte caminho absoluto para forma `~/…` quando estiver sob o home do usuário. */
export function toHomeRelativePath(cwd: string): string {
  const p = cwd.replace(/\/+$/, "").trim();
  if (!p) return "";
  if (p === "~") return p;
  if (p.startsWith("~/")) return p;
  const match = HOME_UNIX_RE.exec(p);
  if (match) return `~${p.slice(match[0].length)}`;
  return p;
}

export function isTruncatedCwdLabel(label: string): boolean {
  const t = label.trim();
  return t.startsWith("\u2026") || t.startsWith("…");
}

/** Label do cwd no rodapé — sem truncar; o CSS preserva o fim do caminho. */
export function shortCwdLabel(cwd: string, _maxLen = 40): string {
  return toHomeRelativePath(cwd);
}

export function shortModelLabel(model: string): string {
  const raw = model.trim();
  if (!raw) return "(modelo)";
  let name = raw.split("/").pop() ?? raw;
  for (const prefix of ["claude-", "claude_", "anthropic-", "anthropic_"]) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  name = name
    .replace(/-/g, " ")
    .replace(/_/g, " ")
    .replace(/\b(\d+)\s+(\d+)\b/g, "$1.$2");
  return capitalizeModelAcronyms(name.trim()) || raw;
}

/**
 * Siglas do nome do modelo em caixa alta.
 *
 * Os ids vêm minúsculos do provedor (`glm-4.7-flash`), e escrever "glm" em
 * minúsculo lê como erro de digitação — é o nome próprio de uma família de
 * modelos, como GPT. Só as siglas mudam: "flash", "turbo", "mini" e "pro"
 * são palavras e continuam como estão.
 */
const MODEL_ACRONYMS = new Set(["glm", "gpt", "qwq", "sdxl", "tts", "stt"]);

function capitalizeModelAcronyms(label: string): string {
  return label
    .split(" ")
    .map((word) =>
      MODEL_ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word,
    )
    .join(" ");
}

/** Custo da sessão no rodapé (paridade com Ink `usageCostLabel`). */
export function composerCostLabel(ctx: {
  show_cost?: boolean;
  cost_usd?: number;
  cost_status?: string;
}): string {
  if (!ctx.show_cost) return "";
  if (
    typeof ctx.cost_usd !== "number" ||
    !Number.isFinite(ctx.cost_usd) ||
    ctx.cost_usd <= 0
  ) {
    return "";
  }
  const prefix = ctx.cost_status === "estimated" ? "~" : "";
  return `${prefix}$${ctx.cost_usd.toFixed(3)}`;
}
