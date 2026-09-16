export type ComposerAgentMode = "agent" | "plan";

export interface ComposerModeOption {
  id: ComposerAgentMode;
  label: string;
}

export const COMPOSER_AGENT_MODES: readonly ComposerModeOption[] = [
  {
    id: "agent",
    label: "Agente",
  },
  {
    id: "plan",
    label: "Plano",
  },
] as const;

export function normalizeComposerAgentMode(
  mode: string | null | undefined,
): ComposerAgentMode {
  return mode === "plan" ? "plan" : "agent";
}

export function resolveComposerModeDisplay(
  footer: Partial<{ agent_mode?: string; agent_mode_label?: string }>,
): string {
  const label = (footer.agent_mode_label ?? "").trim();
  if (label) return label;
  return normalizeComposerAgentMode(footer.agent_mode) === "plan"
    ? "Plano"
    : "Agente";
}

export function composerPlaceholderForMode(
  mode: string | null | undefined,
): string {
  return normalizeComposerAgentMode(mode) === "plan"
    ? "Descreva o que quer planejar…"
    : "Escreva sua mensagem…";
}

/**
 * Seleção COMBINADA do seletor de modo do composer. Funde os dois eixos numa
 * escolha visual de 3 estados:
 * - `agent`/`plan` → agent_mode (executar vs só planejar);
 * - `automatico` → run_mode "automatico" (o Super Note decide Início/Code por
 *   mensagem), sempre com agent_mode "agent".
 */
export type ComposerSelection = "agent" | "plan" | "automatico";

export interface ComposerSelectionOption {
  id: ComposerSelection;
  label: string;
  /** Descrição curta usada no tooltip do item. */
  hint: string;
}

export const COMPOSER_SELECTIONS: readonly ComposerSelectionOption[] = [
  { id: "agent", label: "Agente", hint: "Conversa e executa ações" },
  { id: "plan", label: "Plano", hint: "Planeja antes de executar" },
  {
    id: "automatico",
    label: "Automático",
    hint: "O Super Note escolhe as ferramentas por mensagem",
  },
] as const;

export function normalizeComposerSelection(
  value: string | null | undefined,
): ComposerSelection {
  if (value === "plan") return "plan";
  if (value === "automatico") return "automatico";
  return "agent";
}

export const PLAN_EXECUTE_USER_MESSAGE =
  "Executar o plano da sua última resposta, passo a passo.";

/** Mensagem interna do botão Executar — não mostrar na timeline. */
export function isPlanExecuteUserMessage(content: string): boolean {
  return (content ?? "").trim() === PLAN_EXECUTE_USER_MESSAGE;
}
