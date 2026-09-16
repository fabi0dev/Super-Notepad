const BASE = "";

// Ephemeral session token for protected endpoints.
// Injected into index.html by the server — never fetched via API.
declare global {
  interface Window {
    __SUPER_NOTEPAD_SESSION_TOKEN__?: string;
  }
}
let _sessionToken: string | null = null;
const SESSION_HEADER = "X-Super-Notepad-Session-Token";

function setSessionHeader(headers: Headers, token: string): void {
  if (!headers.has(SESSION_HEADER)) {
    headers.set(SESSION_HEADER, token);
  }
}

function parseJsonBody<T>(url: string, text: string): T {
  const trimmed = text.trimStart().toLowerCase();
  if (trimmed.startsWith("<!")) {
    throw new Error(
      "Resposta HTML em vez de JSON — não é o backend Super Note (ou está desatualizado). " +
        "Use a URL que o comando imprime (ex.: http://localhost:9010/?token=…). " +
        "Se usa `pnpm dev`, defina SUPER_NOTEPAD_DASHBOARD_URL para a mesma base (ex.: http://localhost:9010) e confirme que `python -m super_notepad` está a correr. " +
        `URL obtida: ${typeof window !== "undefined" ? window.location.origin : ""}`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${url}: corpo inválido — ${text.slice(0, 120)}`);
  }
}

export const SESSION_EXPIRED_EVENT = "supernotepad:session-expired";
export const SESSION_EXPIRED_MESSAGE =
  "A sessão do painel expirou porque o servidor reiniciou. Recarregue a página.";

let sessionExpiredNotified = false;

/** Avisa uma vez só — um 401 costuma vir em rajada, um por widget na tela. */
function notifySessionExpired(): void {
  if (sessionExpiredNotified || typeof window === "undefined") return;
  sessionExpiredNotified = true;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

export async function fetchJSON<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  // Inject the session token into all /api/ requests.
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  const token = window.__SUPER_NOTEPAD_SESSION_TOKEN__;
  if (token) {
    setSessionHeader(headers, token);
  }
  const res = await fetch(`${BASE}${url}`, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "manual",
  });
  if (
    res.type === "opaqueredirect" ||
    (res.status >= 300 && res.status < 400)
  ) {
    const loc = res.headers.get("Location") ?? "(sem Location)";
    throw new Error(
      `Redirecionamento ${res.status} em ${url} → ${loc}. ` +
        "Pedidos à API não devem ser redirecionados; confira auth do dashboard ou proxy.",
    );
  }
  const text = await res.text().catch(() => res.statusText);
  if (res.status === 401) {
    // O token do painel é gerado EM MEMÓRIA a cada start do servidor e
    // injetado no HTML. Quando o servidor reinicia (update, crash, sleep da
    // máquina), a aba aberta continua com o token velho e TODO request passa
    // a dar 401 — cada widget mostrando o erro genérico dele ("Não foi
    // possível carregar as pastas") sem que nada diga que a sessão caiu.
    // Um evento global permite explicar isso uma vez, com saída.
    notifySessionExpired();
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }
  if (!res.ok) {
    throw new Error(`${res.status}: ${text}`);
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/html")) {
    throw new Error(
      `Content-Type HTML em ${url} — provável bloqueador de anúncios, proxy ou binário Python antigo. ` +
        `Tente desativar extensões para 127.0.0.1 e confirme: python -c "import super_notepad.web_server" no mesmo venv que \`python -m super_notepad\`. ` +
        `Origem: ${typeof window !== "undefined" ? window.location.origin : ""}`,
    );
  }
  return parseJsonBody<T>(url, text);
}

async function getSessionToken(): Promise<string> {
  if (_sessionToken) return _sessionToken;
  const injected = window.__SUPER_NOTEPAD_SESSION_TOKEN__;
  if (injected) {
    _sessionToken = injected;
    return _sessionToken;
  }
  throw new Error(
    "Session token not available — page must be served by the Super Note dashboard server",
  );
}

/** Resumo de nota (lista) — sem o corpo. */
export interface NoteVersion {
  ts: string;
  title: string;
  preview: string;
  chars: number;
}

export interface NoteSummary {
  id: string;
  title: string;
  snippet: string;
  /** Caminho da pasta ("" = raiz), níveis separados por "/". */
  folder: string;
  created: string;
  updated: string;
  /** Nota favorita (estrela). */
  favorite?: boolean;
  /** Nota bloqueada (cadeado): privada ao usuário — o agente não a vê nem toca. */
  locked?: boolean;
}

/** Nota completa, com o corpo em Markdown. */
export interface Note extends NoteSummary {
  content: string;
}

export const api = {
  getConfig: () => fetchJSON<Record<string, unknown>>("/api/config"),
  getSchema: () =>
    fetchJSON<{ fields: Record<string, unknown>; category_order: string[] }>(
      "/api/config/schema",
    ),
  dashboardWindowToken: () =>
    fetchJSON<{ token: string }>("/api/dashboard/window-token"),
  notesList: () =>
    fetchJSON<{ notes: NoteSummary[]; folders: string[] }>("/api/notes"),
  notesGet: (id: string) =>
    fetchJSON<Note>(`/api/notes/${encodeURIComponent(id)}`),
  /** Linha do tempo: versões da nota (mais recente primeiro). */
  notesHistory: (id: string) =>
    fetchJSON<{ versions: NoteVersion[] }>(
      `/api/notes/${encodeURIComponent(id)}/history`,
    ),
  /** Conteúdo completo de uma versão (para pré-visualizar). */
  notesHistoryVersion: (id: string, ts: string) =>
    fetchJSON<{ ts: string; title: string; content: string }>(
      `/api/notes/${encodeURIComponent(id)}/history/version`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ts }),
      },
    ),
  /** Restaura a nota para uma versão (vira a atual). */
  notesHistoryRestore: (id: string, ts: string) =>
    fetchJSON<Note>(`/api/notes/${encodeURIComponent(id)}/history/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ts }),
    }),
  notesFavorite: (id: string, favorite: boolean) =>
    fetchJSON<Note>(`/api/notes/${encodeURIComponent(id)}/favorite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite }),
    }),
  notesCreate: (title = "", content = "", folder = "") =>
    fetchJSON<Note>("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, folder }),
    }),
  notesUpdate: (
    id: string,
    patch: { title?: string; content?: string; folder?: string },
  ) =>
    fetchJSON<Note>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  notesDelete: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  notesUploadAttachment: async (
    file: File,
  ): Promise<{
    id: string;
    filename: string;
    mime: string;
    bytes: number;
    kind: "image" | "video" | "file";
    url: string;
  }> => {
    const token = await getSessionToken();
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch("/api/notes/attachments", {
      method: "POST",
      headers: { [SESSION_HEADER]: token }, // NÃO setar Content-Type (boundary)
      body: form,
    });
    if (!resp.ok) {
      let detail = `falha ao anexar (${resp.status})`;
      try {
        const j = await resp.json();
        if (j?.detail) detail = j.detail;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    return resp.json();
  },
  notesCreateFolder: (path: string) =>
    fetchJSON<{ ok: boolean; path: string; folders: string[] }>(
      "/api/notes/folders",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      },
    ),
  notesRenameFolder: (oldPath: string, newPath: string) =>
    fetchJSON<{ ok: boolean; path: string; folders: string[] }>(
      "/api/notes/folders",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old: oldPath, new: newPath }),
      },
    ),
  notesDeleteFolder: (path: string) =>
    fetchJSON<{ ok: boolean; folders: string[] }>(
      `/api/notes/folders?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
};
