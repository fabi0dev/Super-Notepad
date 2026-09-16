/**
 * Referências pendentes para o chat — trechos que o usuário mandou "Adicionar
 * ao chat" (de uma nota, por ex.). Viram CHIPS no compositor: citações que o
 * agente recebe junto da próxima mensagem.
 *
 * Mora no localStorage (mesma origem) para atravessar JANELAS: a nota é uma
 * janela, o chat é outra — o mesmo padrão de sync do resto do app. O compositor
 * ouve `subscribe` (mudanças locais) e o `storage` (outra janela).
 */

const KEY = "supernotepad:chat:refs";
const MAX = 12;

export interface ChatReference {
  id: string;
  /** Texto completo do trecho (o que vai pro agente). */
  text: string;
  /** De onde veio (ex.: título da nota) — só rótulo do chip. */
  source?: string;
  ts: number;
}

let items: ChatReference[] = load();
const subs = new Set<() => void>();

function load(): ChatReference[] {
  try {
    const raw =
      typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ChatReference[]) : [];
  } catch {
    return [];
  }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* modo privado: não persiste, tudo bem */
  }
}

function emit(): void {
  for (const f of subs) f();
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function addChatReference(text: string, source?: string): void {
  const clean = (text || "").trim();
  if (!clean) return;
  const src = (source || "").trim() || undefined;
  // Dedup: mesmo texto+origem sobe pro topo em vez de duplicar.
  const dupIdx = items.findIndex((r) => r.text === clean && r.source === src);
  const item: ChatReference = {
    id: dupIdx >= 0 ? items[dupIdx].id : newId(),
    text: clean,
    source: src,
    ts: Date.now(),
  };
  items = [item, ...items.filter((_, i) => i !== dupIdx)].slice(0, MAX);
  save();
  emit();
}

export function getChatReferences(): ChatReference[] {
  return items;
}

export function removeChatReference(id: string): void {
  const before = items.length;
  items = items.filter((r) => r.id !== id);
  if (items.length !== before) {
    save();
    emit();
  }
}

export function clearChatReferences(): void {
  if (!items.length) return;
  items = [];
  save();
  emit();
}

export function subscribeChatReferences(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      items = load();
      emit();
    }
  });
}
