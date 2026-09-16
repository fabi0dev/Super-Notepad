const DRAFT_PREFIX = "supernotepad:chat:draft:";
const LANDING_DRAFT_KEY = `${DRAFT_PREFIX}__new__`;
const MAX_DRAFT_LENGTH = 100_000;

export function getComposerDraftStorageKey(
  sessionId?: string | null,
): string {
  const sid = sessionId?.trim();
  return sid ? `${DRAFT_PREFIX}${sid}` : LANDING_DRAFT_KEY;
}

export function readComposerDraft(sessionId?: string | null): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(
      getComposerDraftStorageKey(sessionId),
    );
    if (!raw) return "";
    return raw.length > MAX_DRAFT_LENGTH
      ? raw.slice(0, MAX_DRAFT_LENGTH)
      : raw;
  } catch {
    return "";
  }
}

export function writeComposerDraft(
  sessionId: string | null | undefined,
  text: string,
): void {
  if (typeof window === "undefined") return;
  try {
    const key = getComposerDraftStorageKey(sessionId);
    if (!text) {
      window.localStorage.removeItem(key);
      return;
    }
    const bounded =
      text.length > MAX_DRAFT_LENGTH
        ? text.slice(0, MAX_DRAFT_LENGTH)
        : text;
    window.localStorage.setItem(key, bounded);
  } catch {
    // quota / modo privado
  }
}

export function clearComposerDraft(sessionId?: string | null): void {
  writeComposerDraft(sessionId, "");
}

// ---------------------------------------------------------------------------
// Referência de nota pendente — o "Perguntar ao Super Notepad" de uma nota anexa a nota
// ao chat novo como um CHIP (sem expor o id). Passa pela mesma origem (o painel
// de chat é um iframe) via localStorage; o ChatPage consome na montagem.
// ---------------------------------------------------------------------------

const NOTE_REF_KEY = "supernotepad:chat:noteref:__new__";

export interface PendingNoteRef {
  title: string;
}

export function writePendingNoteRef(ref: PendingNoteRef | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!ref || !ref.title.trim()) {
      window.localStorage.removeItem(NOTE_REF_KEY);
      return;
    }
    window.localStorage.setItem(
      NOTE_REF_KEY,
      JSON.stringify({ title: ref.title.slice(0, 300) }),
    );
  } catch {
    /* quota / modo privado */
  }
}

export function readPendingNoteRef(): PendingNoteRef | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NOTE_REF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { title?: unknown };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    return title ? { title } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Copiloto do Eco — iframe do /chat (mesmo padrão da nota). O painel grava o
// título e a transcrição ao vivo; o ChatPage prefixa no envio (oculto na bolha).
// ---------------------------------------------------------------------------

const ECO_REF_KEY = "supernotepad:chat:ecoref:__new__";
const ECO_TRANSCRIPT_KEY = "supernotepad:eco:live-transcript";
const ECO_META_KEY = "supernotepad:eco:live-meta";
const ECO_TRANSCRIPT_MAX = 12_000;

export interface PendingEcoRef {
  title: string;
  tags?: string[];
}

export function writePendingEcoRef(ref: PendingEcoRef | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!ref || !ref.title.trim()) {
      window.localStorage.removeItem(ECO_REF_KEY);
      return;
    }
    const tags = (ref.tags ?? [])
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 24);
    window.localStorage.setItem(
      ECO_REF_KEY,
      JSON.stringify({ title: ref.title.slice(0, 300), tags }),
    );
  } catch {
    /* quota / modo privado */
  }
}

export function readPendingEcoRef(): PendingEcoRef | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ECO_REF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { title?: unknown; tags?: unknown };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    if (!title) return null;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0,
        )
      : [];
    return { title, tags };
  } catch {
    return null;
  }
}

export function writeEcoLiveTranscript(text: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = text.trim();
    if (!next) {
      window.localStorage.removeItem(ECO_TRANSCRIPT_KEY);
      return;
    }
    window.localStorage.setItem(ECO_TRANSCRIPT_KEY, next.slice(-ECO_TRANSCRIPT_MAX));
  } catch {
    /* quota / modo privado */
  }
}

export function readEcoLiveTranscript(): string {
  if (typeof window === "undefined") return "";
  try {
    return (window.localStorage.getItem(ECO_TRANSCRIPT_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function writeEcoLiveMeta(ref: PendingEcoRef | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!ref) {
      window.localStorage.removeItem(ECO_META_KEY);
      return;
    }
    const title = ref.title.trim().slice(0, 300);
    const tags = (ref.tags ?? [])
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 24);
    window.localStorage.setItem(ECO_META_KEY, JSON.stringify({ title, tags }));
  } catch {
    /* quota / modo privado */
  }
}

export function readEcoLiveMeta(): PendingEcoRef | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ECO_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { title?: unknown; tags?: unknown };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0,
        )
      : [];
    if (!title && tags.length === 0) return null;
    return { title: title || "Reunião ao vivo", tags };
  } catch {
    return null;
  }
}

export type EcoLiveAssistStyle = "curto" | "equilibrado" | "detalhado";

const ECO_STYLE_RULES: Record<EcoLiveAssistStyle, string> = {
  curto:
    "Estilo CURTO: 1 frase, no máximo 2. Sem preâmbulo, sem 'pelo que entendi', sem perguntar o que precisa.",
  equilibrado: "Estilo EQUILIBRADO: 1–3 frases. Útil e direto, sem enrolar.",
  detalhado:
    "Estilo DETALHADO: um parágrafo curto ou 3–5 bullets. Sem enrolação e sem inventar.",
};

const ECO_LIVE_LISTEN_RULE =
  "Você está OUVINDO a reunião. A transcrição abaixo É o trecho — quem grava " +
  "não precisa colar o áudio. Se a transcrição ainda está vazia ou curta demais " +
  "para a pergunta: diga que ainda está ouvindo (1 frase). NÃO peça o trecho, " +
  "NÃO pergunte 'qual parte', NÃO peça para descrever. Se der para responder " +
  "com o que já foi dito + memória/tags: responda. Não invente o que não ouviu.";

export function buildEcoMeetingContextBlock(
  ref: PendingEcoRef,
  style: EcoLiveAssistStyle = "curto",
): string {
  const label = ref.title.trim() || "Reunião ao vivo";
  const tags = (ref.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const transcript = readEcoLiveTranscript();
  const parts = [`Título: ${label}`];
  if (tags.length) parts.push(`Tags (assunto desta reunião): ${tags.map((t) => `#${t}`).join(" ")}`);
  parts.push(
    transcript.trim()
      ? `Transcrição até agora:\n${transcript}`
      : "Transcrição ainda vazia — a gravação está no começo. Diga que ainda está ouvindo. NÃO peça o trecho.",
  );
  // Comentário HTML — some na bolha e não vira chip `<rag-context>` na UI.
  return (
    `<!--supernotepad:eco-meeting-->\n` +
    `[System note: Copiloto AO VIVO desta reunião. A mensagem do usuário é ` +
    `a pergunta; a transcrição é o que está sendo dito agora. ` +
    `${ECO_LIVE_LISTEN_RULE} ` +
    `Use as tags como assunto da reunião (memória + contexto). ` +
    `Não descreva este bloco. Não comente se a transcrição está ` +
    `confusa/fragmentada. Não dê aula genérica sobre termos da ata. ` +
    `Não diga que não há o que agregar. ` +
    `${ECO_STYLE_RULES[style]}]\n\n` +
    `${parts.join("\n\n")}\n` +
    `<!--/supernotepad:eco-meeting-->\n\n`
  );
}

export function ecoLiveAssistStyleFromConfig(
  config: unknown,
): EcoLiveAssistStyle {
  if (!config || typeof config !== "object") return "curto";
  const eco = (config as Record<string, unknown>).eco;
  if (!eco || typeof eco !== "object") return "curto";
  const live = (eco as Record<string, unknown>).live_assist;
  if (!live || typeof live !== "object") return "curto";
  const style = String(
    (live as Record<string, unknown>).style || "",
  )
    .trim()
    .toLowerCase();
  if (style === "equilibrado" || style === "detalhado") return style;
  return "curto";
}
