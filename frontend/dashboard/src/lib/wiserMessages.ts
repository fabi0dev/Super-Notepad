/** Keep in sync with tools/wiser_tool.py WISER_USER_CANCELLED */
export const WISER_USER_CANCELLED =
  "The user cancelled. Use your best judgement to proceed.";

/** Keep in sync with tools/wiser_tool.py WISER_USER_TIMEOUT */
export const WISER_USER_TIMEOUT =
  "The user did not provide a response within the time limit. Use your best judgement to make the choice and proceed.";

export const WISER_TOOLS = new Set(["wiser", "ask_user", "clarify"]);

/** Fallback quando o modelo omitiu opções (payload legado). */
export const WISER_FALLBACK_CHOICES: readonly string[] = [
  "Continuar com a melhor opção",
  "Parar por agora",
];

export type SettledWiserState = {
  sessionId: string;
  question: string;
  choices?: string[];
  statusLabel: string;
  /** True quando o usuário respondeu de fato (não expirou nem cancelou). */
  answered: boolean;
};

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Garante array de strings — API/SSE podem enviar `choices: null`. */
export function normalizeWiserChoices(value: unknown): string[] {
  if (value == null || !Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
}

/**
 * Sempre devolve ≥2 opções (opções + texto livre na UI).
 * Não inventa opções novas quando o modelo já enviou pelo menos duas.
 */
export function ensureWiserChoices(value: unknown): string[] {
  const normalized = normalizeWiserChoices(value);
  if (normalized.length >= 2) return normalized.slice(0, 4);
  if (normalized.length === 1) {
    return [normalized[0], WISER_FALLBACK_CHOICES[1]];
  }
  return [...WISER_FALLBACK_CHOICES];
}

/** Normaliza payload pendente do Wiser (SSE/API/registry). */
export function normalizePendingWiserPayload<
  T extends {
    sessionId: string;
    question?: string | null;
    choices?: unknown;
    requestId?: string;
  },
>(wiser: T): T & { question: string; choices: string[] } {
  return {
    ...wiser,
    question: (wiser.question ?? "").trim() || "Preciso da sua escolha",
    choices: ensureWiserChoices(wiser.choices),
  };
}

function asStringArray(value: unknown): string[] {
  return normalizeWiserChoices(value);
}

export function humanizeWiserUserResponse(response: string | null | undefined): string {
  const trimmed = (response ?? "").trim();
  if (!trimmed) return "Sem resposta";
  if (trimmed === WISER_USER_CANCELLED) return "Cancelado pelo usuário";
  if (trimmed === WISER_USER_TIMEOUT) return "Sem resposta a tempo";
  return trimmed;
}

/**
 * Todo Wiser resolvido deixa rastro na conversa — inclusive o respondido.
 *
 * Antes só expiração e cancelamento persistiam: quem RESPONDIA não via a
 * própria resposta em lugar nenhum. Ela existia (fica no resultado da
 * ferramenta, gravado na sessão), mas a tela descartava, e a pessoa ficava
 * sem registro do que tinha decidido — só a fala seguinte do agente, que
 * pode nem citar a escolha.
 */
export function shouldPersistSettledWiser(result: string): boolean {
  const parsed = parseJsonRecord(result);
  const response = asString(parsed?.user_response) ?? "";
  return response.trim().length > 0;
}

/** Resolvido POR resposta, e não por expiração/cancelamento. */
export function wiserWasAnswered(result: string): boolean {
  const parsed = parseJsonRecord(result);
  const response = (asString(parsed?.user_response) ?? "").trim();
  if (!response) return false;
  return response !== WISER_USER_TIMEOUT && response !== WISER_USER_CANCELLED;
}

export function buildSettledWiserState(
  result: string,
  fallback?: Pick<SettledWiserState, "question" | "choices">,
): Omit<SettledWiserState, "sessionId"> | null {
  const parsed = parseJsonRecord(result);
  if (!parsed) return null;

  const userResponse = asString(parsed.user_response) ?? "";
  if (!shouldPersistSettledWiser(result)) return null;

  const question =
    asString(parsed.question) ||
    (fallback?.question ?? "").trim() ||
    "Pergunta ao usuário";
  const choicesFromResult = asStringArray(parsed.choices_offered).length
    ? asStringArray(parsed.choices_offered)
    : asStringArray(parsed.choices);
  const choices = ensureWiserChoices(
    choicesFromResult.length > 0
      ? choicesFromResult
      : normalizeWiserChoices(fallback?.choices),
  );

  return {
    question,
    choices,
    statusLabel: humanizeWiserUserResponse(userResponse),
    answered: wiserWasAnswered(result),
  };
}

export function isWiserToolName(name: string): boolean {
  return WISER_TOOLS.has(name.trim().toLowerCase());
}
