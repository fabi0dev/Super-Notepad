import { buildMarkdownUnifiedDiff } from "./planMarkdownDiff";

export interface PlanMessageSnapshot {
  markdown: string;
  displayPath?: string;
  /** Unified diff vs. the previous plan revision in this session. */
  diff?: string;
  revision?: number;
  /** Segment index where the plan card was frozen in the turn timeline. */
  anchorSegmentIndex?: number;
}

export interface PlanExecuteOffer {
  sessionId: string;
  messageId: string;
}

const MIN_PLAN_CHARS = 80;

const PLAN_HEADING_RE =
  /(?:^|\n)(#{1,3}\s*(?:Plano|Plan)\b[^\n]*\n[\s\S]*)/i;
const STRUCTURE_HEADING_RE =
  /(?:^|\n)(##\s*(?:Objetivo|Passos|Steps)\b[^\n]*\n[\s\S]*)/i;
const NUMBERED_STEP_RE = /^\d+\.\s/gm;
const PLAN_SUBSECTION_RE =
  /^##\s*(?:Objetivo|Passos|Steps|Arquivos|Riscos|Crit[eé]rios)\b/im;
const CHECKLIST_RE = /^-\s+\[[ xX]\]\s/gm;
const PLAN_NOISE_RE =
  /modo\s+plano|ferramenta.*bloquead|dropdown|executar\s+plano|continuar\s+planejando|toggle|procurar\s+um\s+bot/gi;
const PLAN_TITLE_HEADING_RE = /^#{1,3}\s*(?:Plano|Plan)\b[^\n]*\n?/i;

/** Remove YAML frontmatter from persisted plan markdown for display. */
export function stripPlanFrontmatter(markdown: string): string {
  const trimmed = (markdown ?? "").trim();
  if (!trimmed.startsWith("---")) return trimmed;
  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) return trimmed;
  const after = trimmed.slice(end + 4);
  return after.replace(/^\s*\n/, "").trim();
}

/** Remove duplicate plan title heading (card already shows "Plano pronto"). */
export function stripPlanTitleHeading(markdown: string): string {
  return (markdown ?? "").trim().replace(PLAN_TITLE_HEADING_RE, "").trim();
}

/** Return the structured plan section, excluding conversational preamble. */
/**
 * O plano já dá para MOSTRAR (card) e portanto REMOVER da conversa.
 *
 * Mais frouxo que `isActionablePlan` (que decide se vale OFERECER executar):
 * basta o cabeçalho `## Plano` e QUALQUER corpo. É o limiar de exibição, e
 * baixá-lo tem duas razões:
 *
 * 1. O flicker: com o antigo `>= 40 caracteres`, o começo do plano aparecia
 *    inline na conversa e só migrava para o card ao cruzar 40 — "escrevendo
 *    em cima e depois embaixo".
 * 2. O botão Executar sumindo: antes do freeze não há oferta persistida, e o
 *    botão depende só desta detecção. Durante o streaming, quando o
 *    `streamingBuffer` e os `segments` dessincronizam por um frame, o texto
 *    combinado encolhe; se isso derrubava o tamanho abaixo de 40, a detecção
 *    caía e o botão piscava. O cabeçalho sobrevive a esses frames — ancorar
 *    nele torna a detecção estável.
 *
 * Continua exigindo CORPO (não só o cabeçalho): um `## Plano` sozinho, ainda
 * sem conteúdo, não é plano — evita carregar o card no primeiro instante do
 * heading, antes de haver o que mostrar.
 */
export function planSectionIsDisplayable(section: string): boolean {
  const trimmed = (section ?? "").trim();
  if (!trimmed) return false;
  if (isActionablePlan(trimmed)) return true;
  const semCabecalho = trimmed.replace(PLAN_TITLE_HEADING_RE, "").trim();
  return semCabecalho.length > 0;
}

export function extractPlanSection(text: string): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";

  const planMatch = raw.match(PLAN_HEADING_RE);
  if (planMatch?.[1]) return planMatch[1].trim();

  const structMatch = raw.match(STRUCTURE_HEADING_RE);
  if (structMatch?.[1]) {
    const section = structMatch[1].trim();
    NUMBERED_STEP_RE.lastIndex = 0;
    if (NUMBERED_STEP_RE.test(section)) return section;
  }

  return "";
}

/** True when markdown looks like a real plan, not UI/meta chatter. */
export function isActionablePlan(text: string): boolean {
  const section = (text ?? "").trim();
  if (section.length < MIN_PLAN_CHARS) return false;

  NUMBERED_STEP_RE.lastIndex = 0;
  const numberedSteps = (section.match(NUMBERED_STEP_RE) ?? []).length;
  const hasSubsections = PLAN_SUBSECTION_RE.test(section);
  CHECKLIST_RE.lastIndex = 0;
  const hasChecklist = CHECKLIST_RE.test(section);
  const hasPlanSignal = numberedSteps >= 2 || hasSubsections || hasChecklist;
  if (!hasPlanSignal) return false;

  PLAN_NOISE_RE.lastIndex = 0;
  const noiseHits = (section.match(PLAN_NOISE_RE) ?? []).length;
  if (noiseHits >= 3 && numberedSteps < 2 && !hasSubsections) return false;

  return true;
}

/** Normalize plan markdown for display in the card/modal. */
export function normalizePlanDisplayMarkdown(markdown: string): string {
  const withoutFrontmatter = stripPlanFrontmatter(markdown);
  return stripPlanTitleHeading(withoutFrontmatter);
}

/** Fallback quando o arquivo em ~/.super-notepad/plans ainda não está disponível. */
export function planMarkdownFromTodoSnapshot(
  snapshot:
    | {
        todos?: ReadonlyArray<{
          content?: string;
          status?: string;
        }>;
      }
    | null
    | undefined,
): string {
  const todos = snapshot?.todos ?? [];
  const steps = todos
    .filter((item) => {
      const status = (item.status ?? "pending").trim().toLowerCase();
      return status !== "cancelled";
    })
    .map((item) => (item.content ?? "").trim())
    .filter(Boolean);
  if (steps.length < 2) return "";

  const body = `## Plano\n\n### Passos\n${steps
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n")}`;
  if (!isActionablePlan(body)) return "";
  return normalizePlanDisplayMarkdown(body);
}

/** Fallback quando o arquivo em ~/.super-notepad/plans ainda não está disponível. */
export function planMarkdownFromAssistantMessage(
  messages: ReadonlyArray<{
    id: string;
    role: string;
    content?: string;
    segments?: ReadonlyArray<{ kind: string; content?: string }>;
  }>,
  messageId: string,
): string {
  const msg = messages.find(
    (item) => item.id === messageId && item.role === "assistant",
  );
  if (!msg) return "";

  let raw = (msg.content ?? "").trim();
  if (!raw) {
    raw = (msg.segments ?? [])
      .filter((segment) => segment.kind === "text")
      .map((segment) => (segment.content ?? "").trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  if (!raw) return "";

  const section = extractPlanSection(raw);
  if (!section || !isActionablePlan(section)) return "";
  return normalizePlanDisplayMarkdown(section);
}

/** Texto do plano a partir da mensagem do assistente ou do snapshot de todo. */
export function planMarkdownFromMessage(
  messages: ReadonlyArray<{
    id: string;
    role: string;
    content?: string;
    segments?: ReadonlyArray<{ kind: string; content?: string }>;
    todoSnapshot?: {
      todos?: ReadonlyArray<{ content?: string; status?: string }>;
    } | null;
  }>,
  messageId: string,
): string {
  const fromAssistant = planMarkdownFromAssistantMessage(messages, messageId);
  if (fromAssistant) return fromAssistant;

  const msg = messages.find(
    (item) => item.id === messageId && item.role === "assistant",
  );
  return planMarkdownFromTodoSnapshot(msg?.todoSnapshot);
}

/** Remove the structured plan section from assistant text shown in the timeline. */
export function stripPlanSectionForDisplay(text: string): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";

  const section = extractPlanSection(raw);
  if (section) {
    const anchor = section.split("\n")[0]?.trim() ?? "";
    if (anchor) {
      const idx = raw.indexOf(anchor);
      if (idx >= 0) {
        return `${raw.slice(0, idx)}${raw.slice(idx + section.length)}`.trim();
      }
    }
  }

  const planMatch = raw.match(PLAN_HEADING_RE);
  if (planMatch?.index != null) {
    return raw.slice(0, planMatch.index).trim();
  }

  const structMatch = raw.match(STRUCTURE_HEADING_RE);
  if (structMatch?.index != null) {
    NUMBERED_STEP_RE.lastIndex = 0;
    const tail = raw.slice(structMatch.index);
    if (NUMBERED_STEP_RE.test(tail)) {
      return raw.slice(0, structMatch.index).trim();
    }
  }

  return raw;
}

export function assistantRawTextFromMessage(
  msg: Readonly<{
    content?: string;
    segments?: ReadonlyArray<{ kind: string; content?: string }>;
    streamingBuffer?: string;
  }>,
): string {
  const fromContent = (msg.content ?? "").trim();
  const segmentText = (msg.segments ?? [])
    .filter((segment) => segment.kind === "text")
    .map((segment) => (segment.content ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  const buffer = (msg.streamingBuffer ?? "").trim();

  if (fromContent) {
    if (buffer && !fromContent.includes(buffer)) {
      return buffer.startsWith(fromContent)
        ? buffer
        : `${fromContent}\n\n${buffer}`;
    }
    return fromContent;
  }
  if (segmentText && buffer) {
    return buffer.startsWith(segmentText)
      ? buffer
      : `${segmentText}\n\n${buffer}`;
  }
  return segmentText || buffer;
}

export function shouldStripPlanFromAssistantText(
  msg: Readonly<{
    role: string;
    content?: string;
    segments?: ReadonlyArray<{ kind: string; content?: string }>;
    streamingBuffer?: string;
    planSnapshot?: PlanMessageSnapshot;
  }>,
): boolean {
  if (msg.role !== "assistant") return false;
  if (msg.planSnapshot?.markdown?.trim()) return true;
  const raw = assistantRawTextFromMessage(msg);
  const section = extractPlanSection(raw);
  if (!section) return false;
  return planSectionIsDisplayable(section);
}

/** Resolve plan card content from snapshot, assistant text, or todo. */
export function resolveAssistantPlanForDisplay(
  msg: Readonly<{
    role: string;
    content?: string;
    segments?: ReadonlyArray<{ kind: string; content?: string }>;
    streamingBuffer?: string;
    planSnapshot?: PlanMessageSnapshot;
    todoSnapshot?: {
      todos?: ReadonlyArray<{ content?: string; status?: string }>;
    } | null;
  }>,
): PlanMessageSnapshot | null {
  if (msg.role !== "assistant") return null;

  if (msg.planSnapshot?.markdown?.trim()) {
    return msg.planSnapshot;
  }

  const fromTodo = planMarkdownFromTodoSnapshot(msg.todoSnapshot);
  if (fromTodo) {
    return { markdown: fromTodo };
  }

  const raw = assistantRawTextFromMessage(msg);
  const section = extractPlanSection(raw);
  if (!section) return null;

  if (planSectionIsDisplayable(section)) {
    return {
      markdown: normalizePlanDisplayMarkdown(section),
      displayPath: msg.planSnapshot?.displayPath,
      diff: msg.planSnapshot?.diff,
      revision: msg.planSnapshot?.revision,
    };
  }

  return null;
}

export function findPreviousPlanMarkdown(
  messages: ReadonlyArray<{
    id: string;
    planSnapshot?: PlanMessageSnapshot;
  }>,
  beforeMessageId: string,
): string {
  let latest = "";
  for (const message of messages) {
    if (message.id === beforeMessageId) break;
    const markdown = message.planSnapshot?.markdown?.trim();
    if (markdown) latest = markdown;
  }
  return latest;
}

export function findLatestPlanMessageId(
  messages: ReadonlyArray<{
    id: string;
    role: string;
    content?: string;
    segments?: ReadonlyArray<{ kind: string; content?: string }>;
    streamingBuffer?: string;
    planSnapshot?: PlanMessageSnapshot;
    todoSnapshot?: {
      todos?: ReadonlyArray<{ content?: string; status?: string }>;
    } | null;
  }>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const plan = resolveAssistantPlanForDisplay(message);
    if (plan?.markdown?.trim()) {
      return message.id;
    }
  }
  return null;
}

/** True when todos already advanced past a waiting plan (agent started alone). */
export function todosIndicatePlanStarted(
  snapshot:
    | {
        todos?: ReadonlyArray<{ status?: string }>;
        summary?: { in_progress?: number; completed?: number };
      }
    | null
    | undefined,
): boolean {
  if (!snapshot) return false;
  const inProgress = Number(snapshot.summary?.in_progress ?? 0);
  const completed = Number(snapshot.summary?.completed ?? 0);
  if (inProgress > 0 || completed > 0) return true;
  return (snapshot.todos ?? []).some((item) => {
    const status = (item.status ?? "").trim().toLowerCase();
    return status === "in_progress" || status === "completed";
  });
}

/**
 * Mensagem cujo card deve mostrar Executar:
 * - só em modo Plano (em Agente o plano é informativo — o agente já corre sozinho)
 * - plano mais recente com conteúdo, se ainda não foi executado/dispensado
 * - esconde se as tarefas do plano já começaram (execução autónima)
 * - fallback: oferta/loading enquanto o snapshot ainda não chegou
 */
export function resolveExecutablePlanMessageId(options: {
  messages: ReadonlyArray<{
    id: string;
    role: string;
    content?: string;
    segments?: ReadonlyArray<{ kind: string; content?: string }>;
    streamingBuffer?: string;
    planSnapshot?: PlanMessageSnapshot;
    todoSnapshot?: {
      todos?: ReadonlyArray<{ content?: string; status?: string }>;
      summary?: { in_progress?: number; completed?: number };
    } | null;
  }>;
  sessionId: string | null | undefined;
  /** Em modo Agente o card de plano não oferece Executar. */
  planMode?: boolean;
  offerMessageId?: string | null;
  loadingMessageId?: string | null;
}): string | null {
  const sid = options.sessionId?.trim() ?? "";
  if (!sid) return null;
  if (!options.planMode) return null;

  const latest = findLatestPlanMessageId(options.messages);
  if (latest) {
    if (isPlanExecuteDismissedForMessage(sid, latest)) return null;
    const latestMessage = options.messages.find(
      (message) => message.id === latest,
    );
    if (todosIndicatePlanStarted(latestMessage?.todoSnapshot)) return null;
    const latestMarkdown =
      resolveAssistantPlanForDisplay(latestMessage ?? { role: "assistant" })
        ?.markdown ?? "";
    if (latestMarkdown && isPlanContentExecuted(sid, latestMarkdown)) {
      return null;
    }
    return latest;
  }

  const fallbackId =
    options.loadingMessageId?.trim() || options.offerMessageId?.trim() || "";
  if (!fallbackId || isPlanExecuteDismissedForMessage(sid, fallbackId)) {
    return null;
  }
  const fallbackMessage = options.messages.find(
    (message) => message.id === fallbackId && message.role === "assistant",
  );
  if (!fallbackMessage) return null;
  if (todosIndicatePlanStarted(fallbackMessage.todoSnapshot)) return null;
  return fallbackId;
}

export function buildPlanMessageSnapshot(
  markdown: string,
  displayPath: string | undefined,
  previousMarkdown: string,
  revision: number,
): PlanMessageSnapshot {
  const normalized = normalizePlanDisplayMarkdown(markdown);
  const previous = normalizePlanDisplayMarkdown(previousMarkdown);
  const diff = buildMarkdownUnifiedDiff(
    previous,
    normalized,
    displayPath || "plan.md",
  );
  return {
    markdown: normalized,
    displayPath,
    diff: diff || undefined,
    revision,
  };
}

function executedPlanStorageKey(sessionId: string): string {
  return `supernotepad:plan-executed:${sessionId.trim()}`;
}

/** Fingerprint estável do conteúdo do plano (para dismiss pós-Executar). */
export function planContentFingerprint(markdown: string): string {
  const normalized = normalizePlanDisplayMarkdown(markdown)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 120)}::${normalized.slice(-120)}::${normalized.length}`;
}

export function readStoredExecutedPlanFingerprint(
  sessionId: string,
): string | null {
  const sid = sessionId.trim();
  if (!sid) return null;
  try {
    const raw = sessionStorage.getItem(executedPlanStorageKey(sid));
    const value = (raw ?? "").trim();
    return value || null;
  } catch {
    return null;
  }
}

export function writeStoredExecutedPlanFingerprint(
  sessionId: string,
  fingerprint: string,
): void {
  const sid = sessionId.trim();
  const fp = fingerprint.trim();
  if (!sid || !fp) return;
  try {
    sessionStorage.setItem(executedPlanStorageKey(sid), fp);
  } catch {
    /* quota / private mode */
  }
}

export function clearStoredExecutedPlanFingerprint(sessionId: string): void {
  const sid = sessionId.trim();
  if (!sid) return;
  try {
    sessionStorage.removeItem(executedPlanStorageKey(sid));
  } catch {
    /* ignore */
  }
}

export function isPlanContentExecuted(
  sessionId: string,
  markdown: string,
): boolean {
  const executed = readStoredExecutedPlanFingerprint(sessionId);
  if (!executed) return false;
  const current = planContentFingerprint(markdown);
  return Boolean(current) && current === executed;
}

/** True when another assistant message already shows this plan (avoid duplicate cards). */
export function findMessageIdWithSamePlan(
  messages: ReadonlyArray<{
    id: string;
    role: string;
    planSnapshot?: PlanMessageSnapshot;
  }>,
  markdown: string,
  exceptMessageId?: string,
): string | null {
  const fingerprint = planContentFingerprint(markdown);
  if (!fingerprint) return null;
  const except = exceptMessageId?.trim() ?? "";
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (except && message.id === except) continue;
    const existing = message.planSnapshot?.markdown?.trim() ?? "";
    if (!existing) continue;
    if (planContentFingerprint(existing) === fingerprint) {
      return message.id;
    }
  }
  return null;
}

function storageKey(sessionId: string): string {
  return `supernotepad:plan-execute:${sessionId.trim()}`;
}

function dismissedStorageKey(sessionId: string): string {
  return `supernotepad:plan-dismissed:${sessionId.trim()}`;
}

/** Message id whose execute offer was dismissed/executed, or `"1"` (legacy session-wide). */
export function readStoredPlanDismissedMessageId(
  sessionId: string,
): string | null {
  const sid = sessionId.trim();
  if (!sid) return null;
  try {
    const raw = sessionStorage.getItem(dismissedStorageKey(sid));
    const value = (raw ?? "").trim();
    return value || null;
  } catch {
    return null;
  }
}

/** True when execute was dismissed for this session (any plan) — legacy `"1"` or any stored id. */
export function readStoredPlanDismissed(sessionId: string): boolean {
  return readStoredPlanDismissedMessageId(sessionId) != null;
}

/** True when execute should stay hidden for this specific plan message. */
export function isPlanExecuteDismissedForMessage(
  sessionId: string,
  messageId: string,
): boolean {
  const dismissed = readStoredPlanDismissedMessageId(sessionId);
  if (!dismissed) return false;
  const mid = messageId.trim();
  if (!mid) return false;
  // Legacy session-wide `"1"` — migrate away so novos planos possam executar.
  if (dismissed === "1") {
    clearStoredPlanDismissed(sessionId);
    return false;
  }
  return dismissed === mid;
}

export function writeStoredPlanDismissed(
  sessionId: string,
  messageId?: string,
): void {
  const sid = sessionId.trim();
  const mid = messageId?.trim();
  if (!sid || !mid) return;
  try {
    sessionStorage.setItem(dismissedStorageKey(sid), mid);
  } catch {
    /* quota / private mode */
  }
}

export function clearStoredPlanDismissed(sessionId: string): void {
  const sid = sessionId.trim();
  if (!sid) return;
  try {
    sessionStorage.removeItem(dismissedStorageKey(sid));
  } catch {
    /* ignore */
  }
}

/** True when persisted plan file content is worth showing in the card. */
export function hasPersistedPlanContent(markdown: string): boolean {
  const normalized = normalizePlanDisplayMarkdown(markdown);
  if (normalized.length < MIN_PLAN_CHARS) return false;
  const section = extractPlanSection(normalized) || normalized;
  return isActionablePlan(section);
}

export function readStoredPlanExecuteOffer(
  sessionId: string,
): PlanExecuteOffer | null {
  const sid = sessionId.trim();
  if (!sid) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(sid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlanExecuteOffer>;
    const messageId = (parsed.messageId ?? "").trim();
    if (!messageId) return null;
    return { sessionId: sid, messageId };
  } catch {
    return null;
  }
}

export function writeStoredPlanExecuteOffer(
  offer: PlanExecuteOffer,
  planMarkdown?: string,
): void {
  const sid = offer.sessionId.trim();
  const messageId = offer.messageId.trim();
  if (!sid) return;
  try {
    sessionStorage.setItem(
      storageKey(sid),
      JSON.stringify({ sessionId: sid, messageId }),
    );
    // Plano já executado: não reabrir o botão Executar.
    if (planMarkdown && isPlanContentExecuted(sid, planMarkdown)) {
      return;
    }
    if (planMarkdown?.trim()) {
      clearStoredExecutedPlanFingerprint(sid);
    }
    clearStoredPlanDismissed(sid);
  } catch {
    /* quota / private mode */
  }
}

export function clearStoredPlanExecuteOffer(sessionId: string): void {
  const sid = sessionId.trim();
  if (!sid) return;
  try {
    sessionStorage.removeItem(storageKey(sid));
  } catch {
    /* ignore */
  }
}

export function dismissStoredPlanExecuteOffer(
  sessionId: string,
  messageId?: string,
  planMarkdown?: string,
): void {
  const sid = sessionId.trim();
  if (!sid) return;
  writeStoredPlanDismissed(sid, messageId);
  if (planMarkdown?.trim()) {
    writeStoredExecutedPlanFingerprint(
      sid,
      planContentFingerprint(planMarkdown),
    );
  }
  clearStoredPlanExecuteOffer(sid);
}
