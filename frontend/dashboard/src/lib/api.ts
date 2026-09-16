const BASE = "";

// Ephemeral session token for protected endpoints.
// Injected into index.html by the server — never fetched via API.
declare global {
  interface Window {
    __SUPER_NOTEPAD_SESSION_TOKEN__?: string;
    __SUPER_NOTEPAD_COMPOSER_FOOTER__?: {
      model?: string;
      model_label?: string;
      provider?: string;
      cwd?: string;
      cwd_label?: string;
      show_cost?: boolean;
      cost_usd?: number;
      cost_status?: string;
    };
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
      "Resposta HTML em vez de JSON — não é o backend Super Notepad (ou está desatualizado). " +
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
    "Session token not available — page must be served by the Super Notepad dashboard server",
  );
}

/**
 * Token de sessão de forma síncrona — para montar a URL de um WebSocket, onde
 * o browser não deixa mandar headers no handshake e o token vai na query. Sem
 * rede: só lê o valor injetado no HTML pelo servidor. "" se ausente.
 */
export function sessionTokenSync(): string {
  return _sessionToken || window.__SUPER_NOTEPAD_SESSION_TOKEN__ || "";
}

export interface ContextUsageLayer {
  name: string;
  tokens: number;
  /** Anotação opcional (ex.: quanto o roteador de fato enviou vs. a capacidade). */
  note?: string;
}

export interface ContextUsageResponse {
  layers: ContextUsageLayer[];
  total_tokens: number;
  context_window: number;
  percent_used: number;
  message_count: number;
  /** false enquanto a sessão não rodou nenhum turno — só a conversa é mensurável. */
  system_prompt_measured: boolean;
}

export interface ChatEffortResponse {
  effort: string;
  levels: string[];
  /** Modelo sem raciocínio: o controle não deve aparecer. */
  supported: boolean;
}

export interface MailAccount {
  email: string;
  imap_host: string;
  smtp_host: string;
  active?: boolean;
  /** Nome editável (apelido) da conta; vazio quando não definido. */
  name?: string;
}

export interface MailStatus {
  connected: boolean;
  account: MailAccount | null;
  accounts: MailAccount[];
}

export interface DriveAccount {
  email: string;
  name: string;
  /** Concedeu o escopo de escrita (drive.file) — pode enviar arquivos. */
  can_write?: boolean;
  /** Concedeu o escopo completo (drive) — pode mover/excluir/renomear. */
  can_manage?: boolean;
}

export interface DriveStatus {
  client_configured: boolean;
  accounts: DriveAccount[];
}

export interface DriveItem {
  id: string;
  name: string;
  mime: string;
  is_folder: boolean;
  modified?: string;
  size?: number | null;
  link?: string;
  icon?: string;
  thumb?: boolean;
  account: string;
  /** Id da pasta-pai (para "revelar" o arquivo na paleta). "" = raiz. */
  parent_id?: string;
}

/** Cadeia de pastas de um arquivo (para revelar no app). */
export interface DriveReveal {
  account: string;
  file: { id: string; name: string };
  /** Pasta que contém o arquivo ("" = raiz). */
  folder_id: string;
  /** Breadcrumb raiz → pasta-pai. */
  path: { id: string; name: string }[];
}

export interface DriveQuota {
  accounts: { email: string; usage: number; limit: number | null }[];
  usage: number;
  limit: number | null;
}

export type TaskRecur = "" | "daily" | "weekdays" | "weekly" | "monthly";

/** Subtarefa enxuta — só título e concluída (sem data/recorrência própria). */
export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  done: boolean;
  ai_capable: boolean;
  /** Data (um dia) "YYYY-MM-DD" ou "" (sem data). */
  due: string;
  /** Recorrência ou "" (sem recorrência). */
  recur: TaskRecur;
  /** Passos da tarefa (podem estar vazios). */
  subtasks: Subtask[];
  created_at: number;
  /** Ordem manual (arrastar-para-reordenar) — desempata tarefas de mesma data. */
  order?: number;
}

/** Lembrete — recado com hora marcada que dispara notificação no horário. */
export interface Reminder {
  id: string;
  text: string;
  /** Instante de disparo ISO local "YYYY-MM-DDThh:mm:ss" ou "" (sem hora). */
  due_at: string;
  done: boolean;
  /** Já avisado (para não notificar de novo). */
  notified: boolean;
  created_at: number;
}

/** Contatos — um campo multivalorado (telefone/e-mail/endereço). */
export interface ContactLine {
  label: string;
  value: string;
}

/** Contatos — uma pessoa na agenda. Só o nome é obrigatório. */
export interface Contact {
  id: string;
  name: string;
  phones: ContactLine[];
  emails: ContactLine[];
  addresses: ContactLine[];
  organization: string;
  role: string;
  /** ISO "AAAA-MM-DD" (ou "--MM-DD" sem ano), ou "". */
  birthday: string;
  notes: string;
  tags: string[];
  created_at: number;
  updated_at: number;
}

/** Campos graváveis de um contato (create/update). */
export type ContactInput = Partial<
  Pick<
    Contact,
    | "name"
    | "phones"
    | "emails"
    | "addresses"
    | "organization"
    | "role"
    | "birthday"
    | "notes"
    | "tags"
  >
>;

// ── Finanças ────────────────────────────────────────────────────────────────
export type FinType = "receita" | "despesa";

export interface FinTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  amount_cents: number;
  type: FinType;
  category: string;
  description: string;
  account_id: string;
  recurring_id: string;
  installment_group: string;
  installment_label: string;
  transfer_group: string;
  transfer_direction: string; // "out" | "in" | ""
  transfer_counterparty: string; // nome da outra conta
  status: "pago" | "pendente";
  created_at: number;
  updated_at: number;
}

export interface FinTransferInput {
  amount?: string | number;
  amount_cents?: number;
  from_account_id: string;
  to_account_id: string;
  description?: string;
  date?: string;
  status?: "pago" | "pendente";
}

export interface FinAccount {
  id: string;
  name: string;
  type: string;
  opening_balance_cents: number;
  balance_cents: number;
  created_at: number;
  updated_at: number;
}

export interface FinCategory {
  id: string;
  name: string;
  type: string;
  emoji: string;
}

export interface FinSummary {
  period: string;
  start: string;
  end: string;
  receita_cents: number;
  despesa_cents: number;
  resultado_cents: number;
  saldo_total_cents: number;
  transacoes: number;
  pendentes: number;
  por_categoria: {
    category: string;
    receita_cents: number;
    despesa_cents: number;
  }[];
}

export interface FinTransactionInput {
  amount?: string | number;
  amount_cents?: number;
  type?: FinType;
  category?: string;
  description?: string;
  account_id?: string;
  date?: string;
  status?: "pago" | "pendente";
}

export interface FinAccountInput {
  name?: string;
  type?: string;
  opening_balance?: string | number;
  opening_balance_cents?: number;
}

export interface FinRecurring {
  id: string;
  description: string;
  amount_cents: number;
  type: FinType;
  category: string;
  account_id: string;
  day: number;
  start_month: string;
  active: boolean;
  created_at: number;
}

export interface FinInstallmentInput {
  amount?: string | number; // total
  installments?: number;
  type?: FinType;
  category?: string;
  description?: string;
  account_id?: string;
  date?: string;
}

export interface FinRecurringInput {
  amount?: string | number;
  amount_cents?: number;
  type?: FinType;
  category?: string;
  description?: string;
  account_id?: string;
  day?: number;
  date?: string; // data do 1º lançamento (deriva o dia e o mês de início)
  start_month?: string;
}

/** Orçamento mensal de uma categoria, com o gasto do mês. */
export interface FinBudget {
  id: string;
  category: string;
  amount_cents: number;
  spent_cents: number;
  remaining_cents: number;
  pct: number;
}

/** Um lançamento proposto pela IA ao importar extrato/comprovante (strings cruas). */
export interface FinImportItem {
  date: string;
  description: string;
  amount: string;
  type: FinType;
  category: string;
}

export interface FinImportPreview {
  transactions: FinImportItem[];
  warnings: string[];
  source: string;
}

/** Backup — uma categoria de dados (Notas, Contatos, Conversas…). */
export interface BackupComponent {
  key: string;
  label: string;
  file_count: number;
  bytes: number;
}

export interface BackupSummary {
  file_count: number;
  bytes: number;
  components: BackupComponent[];
}

/** Vínculo nota↔chat — referência resumida (id + título). */
export interface NoteLinkRef {
  id: string;
  title: string;
}

/** Eco — uma gravação com transcrição e resumo. */
export interface CityMatch {
  name: string;
  region: string;
  country: string;
  country_code: string;
  latitude: number | null;
  longitude: number | null;
}

export interface Weather {
  city: string;
  region: string;
  country: string;
  country_code: string;
  temperature: number | null;
  feels_like: number | null;
  humidity: number | null;
  wind: number | null;
  uv_index: number | null;
  temp_max: number | null;
  temp_min: number | null;
  weather_code: number;
  is_day: boolean;
  description: string;
  emoji: string;
}

/** Mensagem do chat lateral do Eco ao vivo (comentário do agente ou do usuário). */
export interface EcoAssistMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  at: number;
}

/** Ação extraída do resumo — só vira tarefa/lembrete depois da confirmação. */
export interface EcoProposedAction {
  id: string;
  kind: "task" | "reminder";
  title: string;
  due: string;
  due_at: string;
  status: "pending" | "created" | "skipped";
}

export interface Recording {
  id: string;
  title: string;
  created_at: number;
  duration_sec: number;
  bytes: number;
  /** novo | transcrito | resumido */
  status: string;
  has_transcript: boolean;
  summary: string;
  error: string;
  memory_tags: string[];
  title_source?: "user" | "auto" | "default";
  favorite?: boolean;
  /** Só vem em recordingsGet (não na lista). */
  transcript?: string;
  live_transcript?: string;
  assist_messages?: EcoAssistMessage[];
  proposed_actions?: EcoProposedAction[];
  calendar_context?: string;
  /** Job de transcrição vivo no servidor (roda independente do front). O front
   *  só REFLETE: ao carregar, se `true`, mostra o progresso e aguarda. */
  transcribing?: boolean;
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

export interface MailListItem {
  uid: string;
  from_name: string;
  from_addr: string;
  subject: string;
  date: string;
  unread: boolean;
  important?: boolean;
  starred?: boolean;
  snippet?: string;
  /** Conta de origem — presente na agregação multi-conta (Home). */
  account?: string;
}

export interface EventAttendee {
  email: string;
  name?: string;
  /** NEEDS-ACTION | ACCEPTED | DECLINED | TENTATIVE | DELEGATED */
  status?: string;
}

export interface CalendarEvent {
  time: string;
  all_day: boolean;
  title: string;
  location: string;
  recurring: boolean;
  calendar?: string;
  source_id?: string;
  local?: boolean;
  event_id?: string;
  description?: string;
  /** link de conferência (Meet/Teams/Zoom…), quando houver */
  conference?: string;
  /** convidados do evento (com status de RSVP) */
  attendees?: EventAttendee[];
  /** organizador (e-mail) e nome exibido, quando houver */
  organizer?: string;
  organizer_name?: string;
  /** identificador estável do evento (para responder ao convite) */
  uid?: string;
  /** minha resposta ao convite (PARTSTAT): ACCEPTED | DECLINED | TENTATIVE */
  my_response?: string;
  /** convites já enviados para este evento local */
  invited?: boolean;
  /** e-mail da conta dona do evento (agregação multi-conta) */
  account?: string;
  /** presente nas consultas por intervalo (AAAA-MM-DD) */
  date?: string;
  /** hora de fim (HH:MM), quando houver */
  end?: string;
}

export interface InviteResult {
  ok: boolean;
  to?: string[];
  method?: string;
  organizer?: string;
  invite_error?: string;
}

export interface CalendarSource {
  id: string;
  name: string;
  url: string;
  account?: string;
}

export interface LocalEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  end: string;
  location: string;
  description: string;
  conference: string;
  attendees: EventAttendee[];
  all_day: boolean;
  repeat: string;
}

export type LocalEventInput = Omit<LocalEvent, "id"> & {
  /** enviar convites .ics aos convidados ao salvar */
  send_invites?: boolean;
};

export interface AccountOverview {
  email: string;
  name?: string;
  provider: string;
  active: boolean;
  services: {
    email: boolean;
    /** Agenda iCal (leitura) */
    calendar: boolean;
    /** Google Drive conectado (OAuth) */
    drive?: boolean;
    /** OAuth do Google concede escrever RSVP na Agenda */
    calendar_rsvp?: boolean;
  };
}

export interface MailAttachment {
  index: number;
  filename: string;
  mime: string;
  size: number;
}

export interface MailMessage {
  uid: string;
  from_name: string;
  from_addr: string;
  to: string;
  subject: string;
  date: string;
  message_id: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}

export const api = {
  getStatus: (sessionId?: string | null) => {
    const qs = sessionId?.trim()
      ? `?session_id=${encodeURIComponent(sessionId.trim())}`
      : "";
    return fetchJSON<StatusResponse>(`/api/status${qs}`);
  },
  /** Preferir caminho sem ``/setup/`` — alguns bloqueadores substituem a resposta por HTML. */
  getSetupCatalog: () =>
    fetchJSON<SetupCatalogResponse>("/api/firstrun/providers"),
  applySetup: (payload: SetupApplyPayload) =>
    fetchJSON<{ ok: boolean; provider_configured: boolean }>(
      "/api/setup/apply",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
  /** Testa a credencial ao vivo (GET {base}/models). Não persiste nada. */
  setupTestKey: (payload: {
    provider_id: string;
    api_key: string;
    base_url_override?: string;
  }) =>
    fetchJSON<{ ok: boolean; blocking?: boolean; status: number; message: string }>(
      "/api/setup/test-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
  getSessions: (limit = 20, offset = 0) =>
    fetchJSON<PaginatedSessions>(
      `/api/sessions?limit=${limit}&offset=${offset}`,
    ),
  /** Busca full-text (FTS5) no CONTEÚDO das mensagens de todas as conversas.
   *  Devolve a conversa + o trecho onde o termo aparece. */
  searchSessions: (q: string, limit = 30) =>
    fetchJSON<SessionSearchResponse>(
      `/api/sessions/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  getInicioSuggestions: () =>
    fetchJSON<{ suggestions: string[]; dynamic: boolean }>(
      "/api/chat/inicio-suggestions",
    ),
  getSessionDetail: (id: string) =>
    fetchJSON<SessionDetailResponse>(`/api/sessions/${encodeURIComponent(id)}`),
  getSessionMessages: (id: string) =>
    fetchJSON<SessionMessagesResponse>(
      `/api/sessions/${encodeURIComponent(id)}/messages`,
    ),
  getSessionChapters: (id: string) =>
    fetchJSON<SessionChaptersResponse>(
      `/api/sessions/${encodeURIComponent(id)}/chapters`,
    ),
  updateSessionTitle: (id: string, title: string) =>
    fetchJSON<{ ok: boolean; session_id: string; title: string }>(
      `/api/sessions/${encodeURIComponent(id)}/title`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
    ),
  pinSession: (id: string, pinned: boolean) =>
    fetchJSON<{
      ok: boolean;
      session_id: string;
      pinned: boolean;
      pinned_at: number | null;
    }>(`/api/sessions/${encodeURIComponent(id)}/pin`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    }),
  deleteSession: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  /** Contagem de conversas por modo (Início / Code), para o diálogo de exclusão. */
  getSessionModeCounts: () =>
    fetchJSON<{ inicio: number; code: number; total: number }>(
      "/api/sessions/mode-counts",
    ),
  /** Exclui conversas. Sem `modes`, apaga todas; com modes, só as daqueles modos. */
  deleteAllSessions: (modes?: Array<"inicio" | "code">) => {
    const qs =
      modes && modes.length > 0
        ? "?" + modes.map((m) => `modes=${encodeURIComponent(m)}`).join("&")
        : "";
    return fetchJSON<{ ok: boolean; deleted: number }>(`/api/sessions${qs}`, {
      method: "DELETE",
    });
  },
  getLogs: (params: {
    file?: string;
    lines?: number;
    level?: string;
    component?: string;
    search?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params.file) qs.set("file", params.file);
    if (params.lines) qs.set("lines", String(params.lines));
    if (params.level && params.level !== "ALL") qs.set("level", params.level);
    if (params.component && params.component !== "all")
      qs.set("component", params.component);
    if (params.search?.trim()) qs.set("search", params.search.trim());
    return fetchJSON<LogsResponse>(`/api/logs?${qs.toString()}`);
  },
  getAnalytics: (days: number) =>
    fetchJSON<AnalyticsResponse>(`/api/analytics/usage?days=${days}`),
  getConfig: () => fetchJSON<Record<string, unknown>>("/api/config"),
  getSchema: () =>
    fetchJSON<{ fields: Record<string, unknown>; category_order: string[] }>(
      "/api/config/schema",
    ),
  getModelInfo: (sessionId?: string | null) => {
    const qs = sessionId?.trim()
      ? `?session_id=${encodeURIComponent(sessionId.trim())}`
      : "";
    return fetchJSON<ModelInfoResponse>(`/api/model/info${qs}`);
  },
  getModelOptions: (sessionId?: string | null) => {
    const qs = sessionId?.trim()
      ? `?session_id=${encodeURIComponent(sessionId.trim())}`
      : "";
    return fetchJSON<ModelOptionsResponse>(`/api/model/options${qs}`);
  },
  getChatContext: (sessionId?: string | null) => {
    const qs = sessionId?.trim()
      ? `?session_id=${encodeURIComponent(sessionId.trim())}`
      : "";
    return fetchJSON<ChatContextResponse>(`/api/chat/context${qs}`);
  },
  interruptChat: (sessionId: string, discard = false) =>
    fetchJSON<{ ok: boolean }>("/api/chat/interrupt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, discard }),
    }),
  /** Entrega uma mensagem ao turno em andamento (ver `/api/chat/steer`). */
  steerChat: (sessionId: string, message: string, steerId: string) =>
    fetchJSON<{ ok: boolean; status: "queued" | "idle" | "busy" | "error" }>(
      "/api/chat/steer",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          message,
          steer_id: steerId,
        }),
      },
    ),
  getChatStatus: (sessionId: string) =>
    fetchJSON<ChatStatusResponse>(
      `/api/chat/status?session_id=${encodeURIComponent(sessionId)}`,
    ),
  getChatTurn: (sessionId: string) =>
    fetchJSON<ChatTurnResponse>(
      `/api/chat/turn?session_id=${encodeURIComponent(sessionId)}`,
    ),
  getChatActiveSessions: () =>
    fetchJSON<ChatActiveSessionsResponse>("/api/chat/active"),
  getChatBackgroundProcesses: (sessionId: string) =>
    fetchJSON<ChatBackgroundProcessesResponse>(
      `/api/chat/background-processes?session_id=${encodeURIComponent(sessionId)}`,
    ),
  killChatBackgroundProcess: (sessionId: string, procId: string) =>
    fetchJSON<{
      ok: boolean;
      status?: string;
      session_id?: string;
      exit_code?: number | null;
      error?: string;
    }>("/api/chat/background-processes/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, proc_id: procId }),
    }),
  listTerminals: (sessionId: string) =>
    fetchJSON<{ terminals: TerminalInfo[] }>(
      `/api/terminal/list?session_id=${encodeURIComponent(sessionId)}`,
    ),
  createTerminal: (
    sessionId: string,
    cwd: string,
    rows?: number,
    cols?: number,
  ) =>
    fetchJSON<TerminalInfo>("/api/terminal/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, cwd, rows, cols }),
    }),
  killTerminal: (id: string) =>
    fetchJSON<{ ok: boolean }>("/api/terminal/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  renameTerminal: (id: string, title: string) =>
    fetchJSON<TerminalInfo>("/api/terminal/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    }),
  getChatGitPrStatus: (sessionId: string, opts?: { refresh?: boolean }) => {
    const params = new URLSearchParams();
    params.set("session_id", sessionId);
    if (opts?.refresh) params.set("refresh", "1");
    return fetchJSON<GitPrStatus>(
      `/api/chat/git-pr-status?${params.toString()}`,
    );
  },
  getChatGitChanges: (sessionId: string) =>
    fetchJSON<GitChangesResponse>(
      `/api/chat/git/changes?session_id=${encodeURIComponent(sessionId)}`,
    ),
  /** Unified diff de um arquivo — expande o diff ao clicar no painel de Git. */
  getChatGitDiff: (
    sessionId: string,
    path: string,
    opts?: { staged?: boolean; unpushed?: boolean; repo?: string },
  ) =>
    fetchJSON<{ diff: string }>(
      `/api/chat/git/diff?session_id=${encodeURIComponent(sessionId)}` +
        `&path=${encodeURIComponent(path)}` +
        `&staged=${opts?.staged ? "true" : "false"}` +
        `&unpushed=${opts?.unpushed ? "true" : "false"}` +
        (opts?.repo ? `&repo=${encodeURIComponent(opts.repo)}` : ""),
    ),
  /** Quais dos arquivos editados pelo agente ainda NÃO foram commitados. */
  getAgentEditsStatus: (sessionId: string, paths: string[]) =>
    fetchJSON<{ uncommitted: string[] }>("/api/chat/agent-edits/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, paths }),
    }),
  /** Commita TODAS as alterações do repo raiz e (opcional) faz push. Ação do
   *  usuário pelo painel — o front confirma antes (repo+branch à vista). */
  commitChatGit: (
    sessionId: string,
    message: string,
    push = true,
    files: { path: string; repo?: string }[] = [],
  ) =>
    fetchJSON<{
      ok: boolean;
      error?: string;
      results?: {
        repo: string;
        committed?: boolean;
        pushed?: boolean | null;
        push_error?: string;
        branch?: string;
        error?: string;
      }[];
    }>("/api/chat/git/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message, push, files }),
    }),
  /** Descarta as alterações não commitadas de UM arquivo (destrutivo). */
  revertChatGitFile: (sessionId: string, path: string, repo?: string) =>
    fetchJSON<{ ok: boolean; error?: string }>("/api/chat/git/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, path, repo: repo ?? "" }),
    }),
  /** Descarta em LOTE as alterações não commitadas dos arquivos selecionados
   *  (destrutivo). Ação do usuário pelo painel — o front confirma antes. */
  discardChatGit: (
    sessionId: string,
    files: { path: string; repo?: string }[] = [],
  ) =>
    fetchJSON<{
      ok: boolean;
      reverted?: number;
      errors?: { path: string; error: string }[];
      error?: string;
    }>("/api/chat/git/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, files }),
    }),
  getChatApprovalPending: (sessionId: string) =>
    fetchJSON<ChatApprovalPendingResponse>(
      `/api/chat/approval/pending?session_id=${encodeURIComponent(sessionId)}`,
    ),
  respondChatApproval: (payload: ChatApprovalRequest) =>
    fetchJSON<ChatApprovalResponse>("/api/chat/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  getChatWiserPending: (sessionId: string) =>
    fetchJSON<ChatWiserPendingResponse>(
      `/api/chat/wiser/pending?session_id=${encodeURIComponent(sessionId)}`,
    ),
  respondChatWiser: (payload: ChatWiserRequest) =>
    fetchJSON<ChatWiserResponse>("/api/chat/wiser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  toggleChatYolo: (sessionId: string) =>
    fetchJSON<ChatYoloResponse>("/api/chat/yolo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    }),
  setChatAgentMode: (sessionId: string, mode: ComposerAgentMode) =>
    fetchJSON<ChatAgentModeResponse>("/api/chat/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, mode }),
    }),
  getChatPlan: (sessionId: string) =>
    fetchJSON<ChatPlanResponse>(
      `/api/chat/plan?session_id=${encodeURIComponent(sessionId)}`,
    ),
  /** Público — cwd para o rodapé do composer (não exige sessão). */
  getWorkingDirectory: (sessionId?: string | null) => {
    const qs = sessionId?.trim()
      ? `?session_id=${encodeURIComponent(sessionId.trim())}`
      : "";
    return fetchJSON<GitFooterFields & { cwd: string; cwd_label: string }>(
      `/api/cwd${qs}`,
    );
  },
  getRecentProjects: (limit = 10) =>
    fetchJSON<RecentProjectsResponse>(
      `/api/projects/recent?limit=${encodeURIComponent(String(limit))}`,
    ),
  browseFolders: (params: {
    path?: string;
    q?: string;
    hideHidden?: boolean;
  }) => {
    const search = new URLSearchParams();
    if (params.path?.trim()) search.set("path", params.path.trim());
    if (params.q?.trim()) search.set("q", params.q.trim());
    if (params.hideHidden) search.set("hide_hidden", "true");
    const qs = search.toString();
    return fetchJSON<FsBrowseResponse>(`/api/fs/browse${qs ? `?${qs}` : ""}`);
  },
  createFolder: (payload: { path: string; name: string }) =>
    fetchJSON<FsBrowseEntry>("/api/fs/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: payload.path,
        name: payload.name,
      }),
    }),
  openProject: (payload: { path: string; sessionId?: string | null }) =>
    fetchJSON<OpenProjectResponse>("/api/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: payload.path,
        session_id: payload.sessionId?.trim() || undefined,
      }),
    }),
  /** Esquece a pasta de uma landing abandonada (ver endpoint homônimo). */
  clearLandingProject: () =>
    fetchJSON<{ ok: boolean }>("/api/projects/landing/clear", {
      method: "POST",
    }),
  saveConfig: (config: Record<string, unknown>) =>
    fetchJSON<{ ok: boolean }>("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    }),
  getMemory: () => fetchJSON<MemoryResponse>("/api/memory"),
  exportMemory: () => fetchJSON<MemoryExport>("/api/memory/export"),
  importMemory: (entries: MemoryExportEntry[], tags: MemoryExportTag[] = []) =>
    fetchJSON<MemoryImportResult>("/api/memory/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries, tags }),
    }),
  createMemoryEntry: (target: MemoryTarget, content: string) =>
    fetchJSON<{ ok: boolean }>("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, content }),
    }),
  updateMemoryEntry: (target: MemoryTarget, oldText: string, content: string) =>
    fetchJSON<{ ok: boolean }>("/api/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, old_text: oldText, content }),
    }),
  deleteMemoryEntry: (target: MemoryTarget, oldText: string) =>
    fetchJSON<{ ok: boolean }>("/api/memory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, old_text: oldText }),
    }),
  /**
   * Registra uma tag: descrição e, opcionalmente, os diretórios em que as
   * memórias dela valem. `scopes` ausente preserva os já registrados.
   */
  describeMemoryTag: (tag: string, description: string, scopes?: string[]) =>
    fetchJSON<{
      ok: boolean;
      tag: string;
      description: string;
      scopes: string[];
    }>("/api/memory/tags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag, description, scopes }),
    }),
  getContextUsage: (sessionId?: string | null) =>
    fetchJSON<ContextUsageResponse>(
      `/api/chat/context-usage${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`,
    ),
  /** Conversas com entrega autônoma não-lida (badge + notificação do OS). */
  getUnreadDeliveries: () =>
    fetchJSON<{
      unread: {
        session_id: string;
        title: string | null;
        preview: string | null;
        last_active: number | null;
      }[];
      count: number;
    }>(`/api/chat/unread`),
  /** Limpa a não-lida ao abrir a conversa. */
  markSessionRead: (sessionId: string) =>
    fetchJSON<{ ok: boolean; session_id: string }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/read`,
      { method: "POST" },
    ),
  /** Trunca a conversa a partir de um timestamp (inclusive) — base de
   *  regenerar/editar-e-reenviar. Remove a mensagem alvo e tudo depois. */
  truncateSession: (sessionId: string, fromTimestamp: number) =>
    fetchJSON<{ ok: boolean; removed: number; session_id: string }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/truncate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_timestamp: fromTimestamp }),
      },
    ),
  getChatEffort: (sessionId?: string | null) =>
    fetchJSON<ChatEffortResponse>(
      `/api/chat/effort${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`,
    ),
  setChatEffort: (effort: string) =>
    fetchJSON<{ ok: boolean; effort: string; applies: string }>(
      "/api/chat/effort",
      {
        method: "PUT",
        body: JSON.stringify({ effort }),
      },
    ),
  getEnvVars: () => fetchJSON<Record<string, EnvVarInfo>>("/api/env"),
  setEnvVar: (key: string, value: string) =>
    fetchJSON<{ ok: boolean }>("/api/env", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }),
  deleteEnvVar: (key: string) =>
    fetchJSON<{ ok: boolean }>("/api/env", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }),
  revealEnvVar: async (key: string) => {
    const token = await getSessionToken();
    return fetchJSON<{ key: string; value: string }>("/api/env/reveal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SESSION_HEADER]: token,
      },
      body: JSON.stringify({ key }),
    });
  },
  dashboardWindowToken: () =>
    fetchJSON<{ token: string }>("/api/dashboard/window-token"),
  // Camofox gerenciado pelo Super Notepad
  camofoxStatus: () =>
    fetchJSON<CamofoxStatus>("/api/tools/camofox/status"),
  camofoxSetManaged: (enabled: boolean) =>
    fetchJSON<CamofoxStatus>("/api/tools/camofox/managed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  camofoxSetIdle: (minutes: number) =>
    fetchJSON<CamofoxStatus>("/api/tools/camofox/idle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes }),
    }),
  camofoxInstall: () =>
    fetchJSON<CamofoxStatus>("/api/tools/camofox/install", { method: "POST" }),
  camofoxStart: () =>
    fetchJSON<CamofoxStatus>("/api/tools/camofox/start", { method: "POST" }),
  camofoxStop: () =>
    fetchJSON<CamofoxStatus>("/api/tools/camofox/stop", { method: "POST" }),
  // Central de contas
  accountsOverview: () =>
    fetchJSON<{
      accounts: AccountOverview[];
      drive_client_configured?: boolean;
    }>("/api/accounts"),
  // Agenda (Google Agenda via link iCal) — por conta (vazio = conta ativa)
  calendarStatus: (email = "") =>
    fetchJSON<{ connected: boolean; name: string; email: string }>(
      `/api/calendar/status?email=${encodeURIComponent(email)}`,
    ),
  calendarConnect: (url: string, name = "", email = "") =>
    fetchJSON<{ ok: boolean; email: string }>("/api/calendar/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, name, email }),
    }),
  calendarDisconnect: (email = "") =>
    fetchJSON<{ ok: boolean }>(
      `/api/calendar/disconnect?email=${encodeURIComponent(email)}`,
      { method: "POST" },
    ),
  calendarToday: (email = "") =>
    fetchJSON<{ events: CalendarEvent[] }>(
      `/api/calendar/today?email=${encodeURIComponent(email)}`,
    ),
  calendarRange: (start: string, end: string, email = "") =>
    fetchJSON<{ events: CalendarEvent[] }>(
      `/api/calendar/range?start=${start}&end=${end}&email=${encodeURIComponent(email)}`,
    ),
  // Agendas (fontes iCal)
  calendarAllSources: () =>
    fetchJSON<{ sources: CalendarSource[] }>("/api/calendar/all-sources"),
  calendarAddSource: (url: string, name = "", email = "") =>
    fetchJSON<{ ok: boolean }>("/api/calendar/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, name, email }),
    }),
  calendarRemoveSource: (id: string, email = "") =>
    fetchJSON<{ ok: boolean }>(
      `/api/calendar/sources/${encodeURIComponent(id)}?email=${encodeURIComponent(email)}`,
      { method: "DELETE" },
    ),
  // Eventos locais
  calendarEvents: (email = "") =>
    fetchJSON<{ events: LocalEvent[] }>(
      `/api/calendar/events?email=${encodeURIComponent(email)}`,
    ),
  calendarAddEvent: (ev: LocalEventInput, email = "") =>
    fetchJSON<{ ok: boolean; id: string; invite?: InviteResult }>(
      `/api/calendar/events?email=${encodeURIComponent(email)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ev),
      },
    ),
  calendarUpdateEvent: (id: string, ev: LocalEventInput, email = "") =>
    fetchJSON<{ ok: boolean; invite?: InviteResult }>(
      `/api/calendar/events/${encodeURIComponent(id)}?email=${encodeURIComponent(email)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ev),
      },
    ),
  calendarGoogleStatus: () =>
    fetchJSON<{
      connected: boolean;
      accounts: string[];
      client_configured: boolean;
    }>("/api/calendar/google-status"),
  calendarRsvp: (
    payload: {
      uid: string;
      response: "yes" | "no" | "maybe";
      organizer?: string;
      summary?: string;
      date?: string;
      time?: string;
      end?: string;
      all_day?: boolean;
    },
    email = "",
  ) =>
    fetchJSON<{
      ok: boolean;
      response?: string;
      notified?: boolean;
      notify_error?: string;
      /** true quando escreveu direto no Google Agenda (Calendar API/OAuth) */
      google?: boolean;
    }>(
      `/api/calendar/rsvp?email=${encodeURIComponent(email)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
  calendarRemoveEvent: (id: string, email = "", notify = false) =>
    fetchJSON<{ ok: boolean; invite?: InviteResult }>(
      `/api/calendar/events/${encodeURIComponent(id)}?email=${encodeURIComponent(
        email,
      )}&notify=${notify ? "true" : "false"}`,
      { method: "DELETE" },
    ),
  // Google Drive
  driveStatus: () => fetchJSON<DriveStatus>("/api/drive/status"),
  driveSetClient: (client_id: string, client_secret: string) =>
    fetchJSON<{ ok: boolean }>("/api/drive/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id, client_secret }),
    }),
  driveOauthStart: (redirectUri: string) =>
    fetchJSON<{ auth_url: string; state: string }>(
      `/api/drive/oauth/start?redirect_uri=${encodeURIComponent(redirectUri)}`,
    ),
  driveList: (account = "", folderId = "", view = "") =>
    fetchJSON<{ items: DriveItem[] }>(
      `/api/drive/list?account=${encodeURIComponent(account)}&folder_id=${encodeURIComponent(folderId)}&view=${encodeURIComponent(view)}`,
    ),
  driveSearch: (query: string, account = "") =>
    fetchJSON<{ items: DriveItem[] }>(
      `/api/drive/search?query=${encodeURIComponent(query)}&account=${encodeURIComponent(account)}`,
    ),
  driveReveal: (file: string, account = "") =>
    fetchJSON<DriveReveal>(
      `/api/drive/reveal?file=${encodeURIComponent(file)}&account=${encodeURIComponent(account)}`,
    ),
  driveQuota: () => fetchJSON<DriveQuota>("/api/drive/quota"),
  driveCreateFolder: (account: string, name: string, parentId = "") =>
    fetchJSON<{ ok: boolean; folder: DriveItem }>("/api/drive/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, name, parent_id: parentId }),
    }),
  driveUpload: (payload: {
    account: string;
    filename: string;
    content_b64: string;
    mime: string;
    folder_id?: string;
  }) =>
    fetchJSON<{ ok: boolean; file: DriveItem }>("/api/drive/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  driveDisconnect: (email: string) =>
    fetchJSON<{ ok: boolean }>(
      `/api/drive/accounts/${encodeURIComponent(email)}`,
      { method: "DELETE" },
    ),
  notesList: () =>
    fetchJSON<{ notes: NoteSummary[]; folders: string[] }>("/api/notes"),
  notesSearch: (q: string) =>
    fetchJSON<{ notes: NoteSummary[] }>(
      `/api/notes/search?q=${encodeURIComponent(q)}`,
    ),
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
  /** Autocomplete de escrita (ghost text). `signal` cancela ao digitar. */
  notesAutocomplete: (
    params: {
      note_id: string;
      prefix: string;
      suffix: string;
      context: string;
    },
    signal?: AbortSignal,
  ) =>
    fetchJSON<{ completion: string }>("/api/notes/autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
    }),
  notesFavorite: (id: string, favorite: boolean) =>
    fetchJSON<Note>(`/api/notes/${encodeURIComponent(id)}/favorite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite }),
    }),
  notesLock: (id: string, locked: boolean) =>
    fetchJSON<Note>(`/api/notes/${encodeURIComponent(id)}/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked }),
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
  notesFolderContext: (path: string) =>
    fetchJSON<{ folder: string; context: string; memory_tags: string[] }>(
      `/api/notes/folders/context?path=${encodeURIComponent(path)}`,
    ),
  notesSetFolderContext: (
    path: string,
    context: string,
    memoryTags: string[],
  ) =>
    fetchJSON<{
      ok: boolean;
      folder: string;
      context: string;
      memory_tags: string[];
    }>("/api/notes/folders/context", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        context,
        memory_tags: memoryTags,
      }),
    }),
  notesMemoryTags: () =>
    fetchJSON<{ tags: { tag: string; description: string }[] }>(
      "/api/notes/memory-tags",
    ),
  tasksList: () => fetchJSON<{ tasks: Task[] }>("/api/tasks"),
  tasksCreate: (
    title: string,
    opts: {
      aiCapable?: boolean;
      due?: string;
      recur?: TaskRecur;
      subtasks?: Subtask[];
    } = {},
  ) =>
    fetchJSON<{ ok: boolean; task: Task }>("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        ai_capable: opts.aiCapable ?? false,
        due: opts.due ?? "",
        recur: opts.recur ?? "",
        ...(opts.subtasks ? { subtasks: opts.subtasks } : {}),
      }),
    }),
  tasksUpdate: (
    id: string,
    patch: {
      title?: string;
      done?: boolean;
      ai_capable?: boolean;
      due?: string;
      recur?: TaskRecur;
      subtasks?: Subtask[];
    },
  ) =>
    fetchJSON<{ ok: boolean; task: Task }>(
      `/api/tasks/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),
  tasksDelete: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  tasksClearDone: () =>
    fetchJSON<{ ok: boolean }>("/api/tasks/clear-done", { method: "POST" }),
  /** Persiste a nova ordem (ids) de um balde após arrastar-para-reordenar. */
  tasksReorder: (ids: string[]) =>
    fetchJSON<{ ok: boolean; tasks: Task[] }>("/api/tasks/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  remindersList: () =>
    fetchJSON<{ reminders: Reminder[] }>("/api/reminders"),
  remindersCreate: (text: string, dueAt: string) =>
    fetchJSON<{ ok: boolean; reminder: Reminder }>("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, due_at: dueAt }),
    }),
  remindersUpdate: (
    id: string,
    patch: { text?: string; done?: boolean; notified?: boolean; due_at?: string },
  ) =>
    fetchJSON<{ ok: boolean; reminder: Reminder }>(
      `/api/reminders/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),
  remindersDelete: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/reminders/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  contactsList: (q?: string) =>
    fetchJSON<{ contacts: Contact[] }>(
      `/api/contacts${q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
    ),
  contactsGet: (id: string) =>
    fetchJSON<{ contact: Contact }>(`/api/contacts/${encodeURIComponent(id)}`),
  contactsCreate: (input: ContactInput) =>
    fetchJSON<{ ok: boolean; contact: Contact }>("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  contactsUpdate: (id: string, patch: ContactInput) =>
    fetchJSON<{ ok: boolean; contact: Contact }>(
      `/api/contacts/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),
  contactsDelete: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/contacts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  // ── Finanças ──────────────────────────────────────────────────────────────
  financeSummary: (params?: { month?: string; start?: string; end?: string }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set("month", params.month);
    if (params?.start) qs.set("start", params.start);
    if (params?.end) qs.set("end", params.end);
    const q = qs.toString();
    return fetchJSON<FinSummary>(`/api/finance/summary${q ? `?${q}` : ""}`);
  },
  financeTransactions: (params?: {
    start?: string;
    end?: string;
    category?: string;
    account_id?: string;
    type?: FinType;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    const q = qs.toString();
    return fetchJSON<{ transactions: FinTransaction[] }>(
      `/api/finance/transactions${q ? `?${q}` : ""}`,
    );
  },
  financeCreateTransaction: (input: FinTransactionInput) =>
    fetchJSON<{ transaction: FinTransaction }>("/api/finance/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  financeUpdateTransaction: (id: string, patch: FinTransactionInput) =>
    fetchJSON<{ transaction: FinTransaction }>(
      `/api/finance/transactions/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),
  financeDeleteTransaction: (id: string) =>
    fetchJSON<{ ok: boolean }>(
      `/api/finance/transactions/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  financeAccounts: (params?: { month?: string }) =>
    fetchJSON<{ accounts: FinAccount[] }>(
      `/api/finance/accounts${params?.month ? `?month=${encodeURIComponent(params.month)}` : ""}`,
    ),
  financeCreateAccount: (input: FinAccountInput) =>
    fetchJSON<{ account: FinAccount }>("/api/finance/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  financeUpdateAccount: (id: string, patch: FinAccountInput) =>
    fetchJSON<{ account: FinAccount }>(`/api/finance/accounts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  financeDeleteAccount: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/finance/accounts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  financeCategories: () =>
    fetchJSON<{ categories: FinCategory[] }>("/api/finance/categories"),
  financeCreateCategory: (input: { name: string; type?: FinType | "ambos"; emoji?: string }) =>
    fetchJSON<{ category: FinCategory }>("/api/finance/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  financeDeleteCategory: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/finance/categories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  financeBudgets: (params?: { month?: string }) =>
    fetchJSON<{ budgets: FinBudget[] }>(
      `/api/finance/budgets${params?.month ? `?month=${encodeURIComponent(params.month)}` : ""}`,
    ),
  financeSetBudget: (input: { category: string; amount?: string; amount_cents?: number }) =>
    fetchJSON<{ budget: FinBudget }>("/api/finance/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  financeDeleteBudget: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/finance/budgets/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  financeImportPreview: async (file: File): Promise<FinImportPreview> => {
    const token = await getSessionToken();
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch("/api/finance/import/preview", {
      method: "POST",
      headers: { [SESSION_HEADER]: token }, // não setar Content-Type (boundary)
      body: form,
    });
    if (!resp.ok) {
      let detail = `falha ao ler o arquivo (${resp.status})`;
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
  financeImportConfirm: (body: {
    transactions: Array<{
      amount?: string;
      amount_cents?: number;
      type?: FinType;
      category?: string;
      description?: string;
      date?: string;
      account_id?: string;
    }>;
    account_id?: string;
  }) =>
    fetchJSON<{ created: number; errors: number }>("/api/finance/import/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  financeCreateInstallment: (input: FinInstallmentInput) =>
    fetchJSON<{ group: string; installments: number; total_cents: number; each_cents: number }>(
      "/api/finance/installments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    ),
  financeCreateTransfer: (input: FinTransferInput) =>
    fetchJSON<{
      group: string;
      amount_cents: number;
      from_account_id: string;
      to_account_id: string;
      from_name: string;
      to_name: string;
      date: string;
      status: "pago" | "pendente";
    }>("/api/finance/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  financeRecurring: () =>
    fetchJSON<{ recurring: FinRecurring[] }>("/api/finance/recurring"),
  financeCreateRecurring: (input: FinRecurringInput) =>
    fetchJSON<{ recurring: FinRecurring }>("/api/finance/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  financeUpdateRecurring: (id: string, patch: { active: boolean }) =>
    fetchJSON<{ recurring: FinRecurring }>(
      `/api/finance/recurring/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),
  financeDeleteRecurring: (id: string, deleteTransactions = false) =>
    fetchJSON<{ ok: boolean }>(
      `/api/finance/recurring/${encodeURIComponent(id)}?delete_transactions=${deleteTransactions}`,
      { method: "DELETE" },
    ),
  /** Baixa o contato (ou "all") como .vcf (download do navegador). */
  contactsVcardDownload: async (id: string): Promise<void> => {
    const token = await getSessionToken();
    const resp = await fetch(
      `/api/contacts/${encodeURIComponent(id)}/vcard`,
      { headers: { [SESSION_HEADER]: token } },
    );
    if (!resp.ok) throw new Error(`falha ao exportar (${resp.status})`);
    const blob = await resp.blob();
    const cd = resp.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="?([^"]+)"?/);
    const name = m?.[1] || "contato.vcf";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },
  /** Grava o .vcf direto num caminho local (diálogo nativo do desktop). */
  contactsVcardSave: (id: string, path: string) =>
    fetchJSON<{ ok: boolean; path: string }>(
      `/api/contacts/${encodeURIComponent(id)}/vcard/save`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      },
    ),
  // Vínculos nota↔chat
  noteLinksForSession: (sessionId: string) =>
    fetchJSON<{ notes: NoteLinkRef[] }>(
      `/api/note-links?session_id=${encodeURIComponent(sessionId)}`,
    ),
  noteLinksForNote: (noteId: string) =>
    fetchJSON<{ sessions: NoteLinkRef[] }>(
      `/api/note-links?note_id=${encodeURIComponent(noteId)}`,
    ),
  noteLinkCreate: (sessionId: string, noteId: string) =>
    fetchJSON<{ ok: boolean; linked: boolean }>("/api/note-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, note_id: noteId }),
    }),
  noteLinkDelete: (sessionId: string, noteId: string) =>
    fetchJSON<{ ok: boolean; removed: number }>(
      `/api/note-links?session_id=${encodeURIComponent(sessionId)}&note_id=${encodeURIComponent(noteId)}`,
      { method: "DELETE" },
    ),
  noteLinkNewNote: (sessionId: string, title = "") =>
    fetchJSON<{ ok: boolean; note: NoteLinkRef }>("/api/note-links/new-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, title }),
    }),
  remindersClearDone: () =>
    fetchJSON<{ ok: boolean }>("/api/reminders/clear-done", { method: "POST" }),

  // Eco — gravações (áudio → transcrição → resumo)
  recordingsList: () =>
    fetchJSON<{ recordings: Recording[] }>("/api/recordings"),
  recordingsGet: (id: string) =>
    fetchJSON<Recording>(`/api/recordings/${encodeURIComponent(id)}`),
  // Captura nativa do áudio do sistema (macOS/ScreenCaptureKit).
  recordingsSyscapAvailable: () =>
    fetchJSON<{ available: boolean; reason: string }>(
      "/api/recordings/syscap/available",
    ),
  /** Dispara TCC do helper `syscap` e abre Ajustes na lista certa. */
  recordingsSyscapRequestPermission: (opts?: { include_mic?: boolean }) =>
    fetchJSON<{ granted: boolean; status: string }>(
      "/api/recordings/syscap/request-permission",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ include_mic: opts?.include_mic !== false }),
      },
    ),
  recordingsSyscapStart: (opts?: { include_mic?: boolean }) =>
    fetchJSON<{ token: string; include_mic: boolean }>(
      "/api/recordings/syscap/start",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ include_mic: opts?.include_mic !== false }),
      },
    ),
  /** Gravação nativa em andamento (reaparece ao reabrir o app). */
  recordingsActive: () =>
    fetchJSON<{
      recording: boolean;
      token?: string;
      elapsed_sec?: number;
      include_mic?: boolean;
    }>("/api/recordings/active"),
  recordingsNativeFinish: (
    token: string,
    title: string,
    memory_tags: string[] = [],
    liveTranscript = "",
  ) =>
    fetchJSON<Recording>("/api/recordings/native/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        title,
        memory_tags,
        live_transcript: liveTranscript,
      }),
    }),
  recordingsNativeCancel: (token: string) =>
    fetchJSON<{ ok: boolean }>("/api/recordings/native/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }),
  recordingsCreate: (body: {
    title: string;
    audio_base64: string;
    ext: string;
    duration_sec: number;
    memory_tags?: string[];
  }) =>
    fetchJSON<Recording>("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  recordingsTranscribe: (id: string, opts?: { force?: boolean }) =>
    fetchJSON<Recording>(
      `/api/recordings/${encodeURIComponent(id)}/transcribe${
        opts?.force ? "?force=true" : ""
      }`,
      { method: "POST" },
    ),
  // Transcrição AO VIVO: devolve o texto do trecho novo (sistema+mic) desde a
  // última chamada. O front acumula e mostra as últimas linhas.
  recordingsLiveTranscribe: (token: string) =>
    fetchJSON<{ mic: string; sys: string }>("/api/recordings/live-transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }),
  /** Copiloto ao vivo do Eco — poll periódico enquanto grava (não bloqueia). */
  recordingsLiveAssist: (
    token: string,
    transcript: string,
    opts?: { memoryTags?: string[]; title?: string; sessionId?: string },
  ) =>
    fetchJSON<{ messages: EcoAssistMessage[] }>("/api/recordings/live-assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        transcript,
        memory_tags: opts?.memoryTags ?? [],
        title: opts?.title ?? "",
        session_id: opts?.sessionId ?? "",
      }),
    }),
  /** Usuário escreveu no chat lateral do Eco — o agente sempre responde. */
  recordingsLiveAssistSay: (
    token: string,
    transcript: string,
    text: string,
    opts?: { memoryTags?: string[]; title?: string },
  ) =>
    fetchJSON<{ messages: EcoAssistMessage[] }>(
      "/api/recordings/live-assist/say",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          transcript,
          text,
          memory_tags: opts?.memoryTags ?? [],
          title: opts?.title ?? "",
        }),
      },
    ),
  recordingsNoteFromTranscript: (body: {
    transcript: string;
    title?: string;
    memory_tags?: string[];
  }) =>
    fetchJSON<{
      sufficient: boolean;
      reason: string;
      title: string;
      markdown: string;
    }>("/api/recordings/note-from-transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  recordingsSummarize: (
    id: string,
    body?: { memory_tags?: string[] },
  ) =>
    fetchJSON<Recording>(
      `/api/recordings/${encodeURIComponent(id)}/summarize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      },
    ),
  recordingsApplyActions: (id: string, ids: string[]) =>
    fetchJSON<{
      recording: Recording;
      tasks: Task[];
      reminders: Reminder[];
      errors: string[];
    }>(`/api/recordings/${encodeURIComponent(id)}/actions/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  recordingsSetTags: (id: string, memory_tags: string[]) =>
    fetchJSON<Recording>(
      `/api/recordings/${encodeURIComponent(id)}/tags`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory_tags }),
      },
    ),
  recordingsRename: (id: string, title: string) =>
    fetchJSON<Recording>(`/api/recordings/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  recordingsFavorite: (id: string, favorite: boolean) =>
    fetchJSON<Recording>(
      `/api/recordings/${encodeURIComponent(id)}/favorite`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite }),
      },
    ),
  recordingsDelete: (id: string) =>
    fetchJSON<{ ok: boolean; removed: number }>(
      `/api/recordings/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  /** Busca o áudio autenticado e devolve um object URL (lembre de revogar). */
  recordingAudioObjectUrl: async (id: string): Promise<string> => {
    const token = await getSessionToken();
    const resp = await fetch(
      `/api/recordings/${encodeURIComponent(id)}/audio`,
      { headers: { [SESSION_HEADER]: token } },
    );
    if (!resp.ok) throw new Error(`áudio indisponível (${resp.status})`);
    return URL.createObjectURL(await resp.blob());
  },
  integrationsCustomList: () =>
    fetchJSON<{ integrations: CustomIntegration[] }>("/api/integrations/custom"),
  integrationsCustomCreate: (body: {
    name: string;
    base_url: string;
    auth_type: string;
    token?: string;
    username?: string;
    password?: string;
    api_key_header?: string;
  }) =>
    fetchJSON<CustomIntegration>("/api/integrations/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  integrationsCustomUpdate: (
    id: string,
    body: {
      name?: string;
      base_url?: string;
      auth_type?: string;
      api_key_header?: string;
      guide?: string;
    },
  ) =>
    fetchJSON<CustomIntegration>(
      `/api/integrations/custom/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  /** O Super Notepad reestrutura o playbook (como ele usa a API) — devolve o guia novo. */
  integrationsCustomRefreshGuide: (id: string) =>
    fetchJSON<{ ok: boolean; guide: string }>(
      `/api/integrations/custom/${encodeURIComponent(id)}/guide/refresh`,
      { method: "POST" },
    ),
  /** Segredo real (token/senha) da integração — só p/ o olho/copiar da UI. */
  integrationsCustomRevealSecret: (id: string) =>
    fetchJSON<{ token: string; password: string }>(
      `/api/integrations/custom/${encodeURIComponent(id)}/secret`,
    ),
  integrationsCustomDelete: (id: string) =>
    fetchJSON<{ ok: boolean }>(
      `/api/integrations/custom/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  integrationsCustomSetCredential: (
    id: string,
    body: { token?: string; username?: string; password?: string },
  ) =>
    fetchJSON<CustomIntegration>(
      `/api/integrations/custom/${encodeURIComponent(id)}/credential`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  backupSummary: () =>
    fetchJSON<BackupSummary>("/api/backup/summary"),
  /** Categorias presentes num .zip de backup (antes de importar). */
  backupInspect: async (file: File): Promise<{ components: BackupComponent[] }> => {
    const token = await getSessionToken();
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch("/api/backup/inspect", {
      method: "POST",
      headers: { [SESSION_HEADER]: token },
      body: form,
    });
    if (!resp.ok) throw new Error(`falha ao ler o backup (${resp.status})`);
    return resp.json();
  },
  /** GERA o zip num temporário (o diálogo de salvar só abre DEPOIS disto). */
  backupPrepare: async (
    components?: string[],
  ): Promise<{ ok: boolean; temp: string; name: string; bytes: number }> => {
    const token = await getSessionToken();
    const resp = await fetch("/api/backup/prepare", {
      method: "POST",
      headers: { [SESSION_HEADER]: token, "Content-Type": "application/json" },
      body: JSON.stringify({ components: components ?? null }),
    });
    if (!resp.ok) {
      let detail = `falha ao gerar o backup (${resp.status})`;
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
  /** Move o zip preparado pro caminho escolhido no diálogo. */
  backupFinalize: async (
    temp: string,
    path: string,
  ): Promise<{ ok: boolean; path: string; bytes: number }> => {
    const token = await getSessionToken();
    const resp = await fetch("/api/backup/finalize", {
      method: "POST",
      headers: { [SESSION_HEADER]: token, "Content-Type": "application/json" },
      body: JSON.stringify({ temp, path }),
    });
    if (!resp.ok) {
      let detail = `falha ao salvar (${resp.status})`;
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
  /** Apaga o zip preparado (usuário cancelou o diálogo) — limpa o resíduo. */
  backupDiscard: async (temp: string): Promise<void> => {
    try {
      const token = await getSessionToken();
      await fetch("/api/backup/discard", {
        method: "POST",
        headers: { [SESSION_HEADER]: token, "Content-Type": "application/json" },
        body: JSON.stringify({ temp }),
      });
    } catch {
      /* best-effort */
    }
  },
  /** Baixa o backup completo como .zip e dispara o download no navegador. */
  /** Baixa o ícone da marca (autenticado) e devolve um objectURL, ou null. */
  integrationsCustomIconUrl: async (id: string): Promise<string | null> => {
    try {
      const token = await getSessionToken();
      const resp = await fetch(
        `/api/integrations/custom/${encodeURIComponent(id)}/icon`,
        { headers: { [SESSION_HEADER]: token } },
      );
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  },
  backupExport: async (components?: string[]): Promise<void> => {
    const token = await getSessionToken();
    const qs =
      components && components.length
        ? `?components=${encodeURIComponent(components.join(","))}`
        : "";
    const resp = await fetch(`/api/backup/export${qs}`, {
      headers: { [SESSION_HEADER]: token },
    });
    if (!resp.ok) throw new Error(`falha ao exportar (${resp.status})`);
    const blob = await resp.blob();
    const cd = resp.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="?([^"]+)"?/);
    const name = m?.[1] || "sn-backup.zip";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },
  backupImport: async (
    file: File,
    mode: "merge" | "replace",
    components?: string[],
  ): Promise<{
    mode: string;
    written: number;
    merged: number;
    skipped: number;
    errors: number;
    snapshot: string | null;
  }> => {
    const token = await getSessionToken();
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    if (components && components.length) form.append("components", components.join(","));
    const resp = await fetch("/api/backup/import", {
      method: "POST",
      headers: { [SESSION_HEADER]: token }, // NÃO setar Content-Type (boundary)
      body: form,
    });
    if (!resp.ok) {
      let detail = `falha ao importar (${resp.status})`;
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
  backupRollback: () =>
    fetchJSON<{
      mode: string;
      written: number;
      merged: number;
      skipped: number;
      errors: number;
      snapshot: string | null;
    }>("/api/backup/rollback", { method: "POST" }),
  driveFolders: (account = "") =>
    fetchJSON<{ items: DriveItem[] }>(
      `/api/drive/folders?account=${encodeURIComponent(account)}`,
    ),
  driveTrash: (account: string, fileIds: string[]) =>
    fetchJSON<{ ok: boolean; count: number }>("/api/drive/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, file_ids: fileIds }),
    }),
  driveUntrash: (account: string, fileIds: string[]) =>
    fetchJSON<{ ok: boolean; count: number }>("/api/drive/untrash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, file_ids: fileIds }),
    }),
  driveDelete: (account: string, fileIds: string[]) =>
    fetchJSON<{ ok: boolean; count: number }>("/api/drive/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, file_ids: fileIds }),
    }),
  driveMove: (account: string, fileIds: string[], folderId: string) =>
    fetchJSON<{ ok: boolean; count: number }>("/api/drive/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, file_ids: fileIds, folder_id: folderId }),
    }),
  driveRename: (account: string, fileId: string, name: string) =>
    fetchJSON<{ ok: boolean; file: DriveItem }>("/api/drive/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, file_id: fileId, name }),
    }),
  mailStatus: () => fetchJSON<MailStatus>("/api/mail/status"),
  mailConnect: (payload: {
    email: string;
    app_password: string;
    imap_host?: string;
    smtp_host?: string;
  }) =>
    fetchJSON<{ ok: boolean; account: MailAccount }>("/api/mail/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  mailDisconnect: (email = "") =>
    fetchJSON<{ ok: boolean; connected: boolean }>("/api/mail/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  mailSetActive: (email: string) =>
    fetchJSON<{ ok: boolean; account: MailAccount | null }>(
      "/api/mail/accounts/active",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      },
    ),
  mailSetAccountName: (email: string, name: string) =>
    fetchJSON<{ ok: boolean; accounts: MailAccount[] }>(
      "/api/mail/accounts/name",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name }),
      },
    ),
  mailInbox: (limit = 30) =>
    fetchJSON<{ messages: MailListItem[]; unread: number }>(
      `/api/mail/inbox?limit=${limit}`,
    ),
  // Caixa unificada — todas as contas (ou só `account`, o filtro).
  mailInboxAll: (limit = 50, account = "") =>
    fetchJSON<{ messages: MailListItem[]; unread: number }>(
      `/api/mail/inbox-all?limit=${limit}&account=${encodeURIComponent(account)}`,
    ),
  mailSync: (limit = 30) =>
    fetchJSON<{ messages: MailListItem[]; unread: number }>(
      `/api/mail/sync?limit=${limit}`,
      { method: "POST" },
    ),
  mailSearch: (q: string, limit = 50) =>
    fetchJSON<{ messages: MailListItem[] }>(
      `/api/mail/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  getDesktopAutostart: () =>
    fetchJSON<{ supported: boolean; enabled: boolean }>(
      "/api/desktop/autostart",
    ),
  setDesktopAutostart: (enabled: boolean) =>
    fetchJSON<{ ok: boolean; supported: boolean; enabled: boolean }>(
      "/api/desktop/autostart",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
    ),
  mailUnreadCount: () => fetchJSON<{ count: number }>("/api/mail/unread-count"),
  mailUnreadAll: (limit = 20) =>
    fetchJSON<{ messages: MailListItem[]; unread: number; syncing?: boolean }>(
      `/api/mail/unread-all?limit=${limit}`,
    ),
  mailReadAll: () =>
    fetchJSON<{ marked: number; unread: number }>("/api/mail/read-all", {
      method: "POST",
    }),
  mailMessageAction: (
    uid: string,
    action: "unread" | "read" | "archive" | "trash",
    folder = "inbox",
    account = "",
  ) =>
    fetchJSON<{ ok: boolean; unread: number }>(
      `/api/mail/message/${encodeURIComponent(uid)}/${action}?folder=${encodeURIComponent(folder)}&account=${encodeURIComponent(account)}`,
      { method: "POST" },
    ),
  mailStar: (uid: string, starred: boolean, folder = "inbox", account = "") =>
    fetchJSON<{ ok: boolean; starred: boolean }>(
      `/api/mail/message/${encodeURIComponent(uid)}/star?folder=${encodeURIComponent(folder)}&account=${encodeURIComponent(account)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred }),
      },
    ),
  mailImportant: (
    uid: string,
    important: boolean,
    folder = "inbox",
    account = "",
  ) =>
    fetchJSON<{ ok: boolean; important: boolean }>(
      `/api/mail/message/${encodeURIComponent(uid)}/important?folder=${encodeURIComponent(folder)}&account=${encodeURIComponent(account)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ important }),
      },
    ),
  mailMessage: (uid: string, folder = "inbox", account = "") =>
    fetchJSON<MailMessage>(
      `/api/mail/message/${encodeURIComponent(uid)}?folder=${encodeURIComponent(folder)}&account=${encodeURIComponent(account)}`,
    ),
  mailFolder: (folder: string, limit = 50, account = "") =>
    fetchJSON<{ messages: MailListItem[] }>(
      `/api/mail/folder/${encodeURIComponent(folder)}?limit=${limit}&account=${encodeURIComponent(account)}`,
    ),
  mailSend: (payload: {
    to: string;
    subject: string;
    body: string;
    in_reply_to?: string;
    account?: string;
    attachments?: {
      filename: string;
      content_b64: string;
      mime: string;
    }[];
  }) =>
    fetchJSON<{ ok: boolean; to: string }>("/api/mail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  mailAiReply: (context: string, instruction = "") =>
    fetchJSON<{ draft: string }>("/api/mail/ai-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, instruction }),
    }),
  transcribeChatAudio: async (payload: ChatTranscribeRequest) => {
    const token = await getSessionToken();
    return fetchJSON<ChatTranscribeResponse>("/api/chat/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SESSION_HEADER]: token,
      },
      body: JSON.stringify(payload),
    });
  },

  // Cron jobs
  getCronJobs: () => fetchJSON<CronJob[]>("/api/cron/jobs"),
  createCronJob: (job: {
    prompt: string;
    schedule: string;
    name?: string;
    deliver?: string;
  }) =>
    fetchJSON<CronJob>("/api/cron/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    }),
  updateCronJob: (
    id: string,
    patch: { prompt?: string; schedule?: string; name?: string; deliver?: string },
  ) =>
    fetchJSON<CronJob>(`/api/cron/jobs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  previewCronSchedule: (schedule: string, count = 3) =>
    fetchJSON<CronSchedulePreview>(
      `/api/cron/preview?schedule=${encodeURIComponent(schedule)}&count=${count}`,
    ),
  pauseCronJob: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/cron/jobs/${id}/pause`, {
      method: "POST",
    }),
  resumeCronJob: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/cron/jobs/${id}/resume`, {
      method: "POST",
    }),
  triggerCronJob: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/cron/jobs/${id}/trigger`, {
      method: "POST",
    }),
  deleteCronJob: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/cron/jobs/${id}`, { method: "DELETE" }),

  // Skills & Toolsets
  getSkills: () => fetchJSON<SkillInfo[]>("/api/skills"),
  getSkillContent: (name: string) =>
    fetchJSON<SkillContentResponse>(
      `/api/skills/${encodeURIComponent(name)}/content`,
    ),
  createSkill: (body: SkillCreateRequest) =>
    fetchJSON<SkillMutationResponse>("/api/skills", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSkillContent: (name: string, content: string) =>
    fetchJSON<SkillMutationResponse>(
      `/api/skills/${encodeURIComponent(name)}/content`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      },
    ),
  deleteSkill: (name: string) =>
    fetchJSON<SkillMutationResponse>(
      `/api/skills/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
  toggleSkill: (name: string, enabled: boolean) =>
    fetchJSON<{ ok: boolean }>("/api/skills/toggle", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, enabled }),
    }),
  getWeather: (city: string, lat?: number | null, lon?: number | null) => {
    const qs = new URLSearchParams({ city });
    if (lat != null && lon != null) {
      qs.set("latitude", String(lat));
      qs.set("longitude", String(lon));
    }
    return fetchJSON<Weather>(`/api/weather?${qs.toString()}`);
  },
  searchCities: (q: string) =>
    fetchJSON<{ results: CityMatch[] }>(
      `/api/weather/cities?q=${encodeURIComponent(q)}`,
    ),
  validateOpenRouterModels: (ids: string[]) =>
    fetchJSON<{ results: Record<string, OpenRouterModelMeta> }>(
      `/api/openrouter/validate-models?ids=${encodeURIComponent(ids.join(","))}`,
    ),
  getToolsets: () => fetchJSON<ToolsetInfo[]>("/api/tools/toolsets"),
  toggleToolset: (name: string, enabled: boolean) =>
    fetchJSON<{ ok: boolean; name: string; enabled: boolean }>(
      "/api/tools/toolsets/toggle",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, enabled }),
      },
    ),


  // Reinicia o daemon do Super Notepad (aplica import, etc.). O servidor derruba a si
  // mesmo e sobe um novo na mesma porta — a resposta pode não chegar se formos
  // mortos antes; o chamador espera a porta voltar e recarrega.
  restartDaemon: () =>
    fetchJSON<{ ok: boolean; port?: number }>("/api/system/restart", {
      method: "POST",
    }),

  // Gateway / update actions
  restartGateway: () =>
    fetchJSON<ActionResponse>("/api/gateway/restart", { method: "POST" }),
  startGateway: () =>
    fetchJSON<ActionResponse>("/api/gateway/start", { method: "POST" }),
  stopGateway: () =>
    fetchJSON<ActionResponse>("/api/gateway/stop", { method: "POST" }),
  getGatewayPlatforms: () =>
    fetchJSON<GatewayPlatformsResponse>("/api/gateway/platforms"),
  getGatewayPlatform: (key: string) =>
    fetchJSON<{ ok: boolean; platform: GatewayPlatformDetail }>(
      `/api/gateway/platforms/${encodeURIComponent(key)}`,
    ),
  saveGatewayPlatform: (
    key: string,
    body: {
      vars?: Record<string, string>;
      allowlist_access?: "open" | "pairing" | "deny";
      TELEGRAM_AUTO_HOME?: string;
    },
  ) =>
    fetchJSON<{
      ok: boolean;
      saved: string[];
      state: string;
      gateway_restart?: {
        ok: boolean;
        pid?: number;
        name?: string;
        error?: string;
      };
    }>(`/api/gateway/platforms/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  disconnectGatewayPlatform: (key: string) =>
    fetchJSON<{
      ok: boolean;
      removed: string[];
      state: string;
      session_cleared?: boolean;
    }>(`/api/gateway/platforms/${encodeURIComponent(key)}`, {
      method: "DELETE",
    }),
  ensureWhatsAppBridgeDeps: () =>
    fetchJSON<{ ok: boolean }>("/api/gateway/whatsapp/deps/ensure", {
      method: "POST",
    }),
  startWhatsAppPair: (body: {
    mode?: string;
    reset_session?: boolean;
    allowed_users?: string;
  }) =>
    fetchJSON<{ ok: boolean; port?: number; mode?: string; error?: string }>(
      "/api/gateway/whatsapp/pair/start",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  getWhatsAppPairStatus: () =>
    fetchJSON<WhatsAppPairStatusResponse>("/api/gateway/whatsapp/pair/status"),
  cancelWhatsAppPair: () =>
    fetchJSON<{ ok: boolean }>("/api/gateway/whatsapp/pair/cancel", {
      method: "POST",
    }),
  getActionStatus: (name: string, lines = 200) =>
    fetchJSON<ActionStatusResponse>(
      `/api/actions/${encodeURIComponent(name)}/status?lines=${lines}`,
    ),

  logout: () =>
    fetchJSON<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
};

export interface ActionResponse {
  name: string;
  ok: boolean;
  pid: number;
}

export interface ActionStatusResponse {
  exit_code: number | null;
  lines: string[];
  name: string;
  pid: number | null;
  running: boolean;
}

export interface PlatformStatus {
  error_code?: string;
  error_message?: string;
  state: string;
  updated_at: string;
}

export interface GatewayPlatformVarSchema {
  name: string;
  prompt: string;
  help: string;
  password: boolean;
  is_allowlist: boolean;
}

export interface GatewayPlatformSummary {
  key: string;
  label: string;
  emoji: string;
  token_var: string;
  setup_instructions: string[];
  vars: GatewayPlatformVarSchema[];
  setup_kind: "form" | "whatsapp_wizard" | "terminal_only";
  status_text: string;
  state: string;
}

export interface GatewayRuntimeSummary {
  gateway_state?: string;
  exit_reason?: string;
  active_agents?: number;
  restart_requested?: boolean;
  platform_errors?: Record<
    string,
    { state: string; error_message?: string; error_code?: string | number }
  >;
}

export interface GatewayPlatformsResponse {
  ok: boolean;
  platforms: GatewayPlatformSummary[];
  managed: boolean;
  gateway_running: boolean;
  gateway_state: string | null;
  runtime_summary: GatewayRuntimeSummary;
  configured_keys: string[];
  partial_keys: string[];
  next_steps: string[];
  channels_ui_path: string;
  env_ui_path: string;
}

export interface GatewayPlatformVarValue {
  name: string;
  is_set: boolean;
  value: string;
  password: boolean;
  is_allowlist: boolean;
}

export interface GatewayPlatformDetail extends GatewayPlatformSummary {
  vars_values: GatewayPlatformVarValue[];
  whatsapp_mode?: string;
  whatsapp_enabled?: boolean;
  whatsapp_allowed_users?: string;
  /** Telegram: https://t.me/<username> when token is configured. */
  bot_url?: string;
}

export interface WhatsAppPairStatusResponse {
  state: string;
  message?: string | null;
  qrDataUrl?: string | null;
  error?: string | null;
}

export interface GitFooterFields {
  cwd_dir_name?: string;
  git_branch?: string | null;
  git_modified?: number;
  git_untracked?: number;
  /** Commits ahead of upstream (unpushed). */
  git_ahead?: number;
  /** Commits behind upstream. */
  git_behind?: number;
  /** Web: true after the user opens a project folder (not default home). */
  workspace_defined?: boolean;
}

export interface StatusResponse extends GitFooterFields {
  active_sessions: number;
  /** Diretório de trabalho do agente (rodapé do composer). */
  cwd?: string;
  cwd_label?: string;
  /** Modelo configurado / sessão web (rodapé do composer). */
  model?: string;
  model_label?: string;
  provider?: string;
  config_path: string;
  config_version: number;
  env_path: string;
  gateway_exit_reason: string | null;
  gateway_health_url: string | null;
  gateway_pid: number | null;
  gateway_platforms: Record<string, PlatformStatus>;
  gateway_running: boolean;
  gateway_state: string | null;
  gateway_updated_at: string | null;
  super_notepad_home: string;
  latest_config_version: number;
  managed?: boolean;
  managed_system?: string | null;
  provider_configured?: boolean;
  version: string;
  version_code: number;
  version_name: string;
}

export interface SetupCatalogProvider {
  id: string;
  name: string;
  auth_type: string;
  api_key_env_vars: string[];
  base_url_env_var: string;
  model_hints: string[];
}

export interface SetupCatalogResponse {
  managed: boolean;
  managed_message: string | null;
  providers: SetupCatalogProvider[];
}

export interface SetupApplyPayload {
  nickname?: string;
  personality?: string;
  inference?: {
    provider_id: string;
    model: string;
    secrets: Record<string, string>;
    base_url_override?: string;
  };
  terminal_backend?: string;
  terminal_cwd?: string;
  apply_recommended_agent_defaults?: boolean;
  agent_max_turns?: number;
  agent_tool_progress?: string;
  toolsets_cli?: string[];
  compression_threshold?: number;
  session_reset_mode?: "daily" | "idle" | "both" | "none";
  session_reset_at_hour?: number;
  session_reset_idle_minutes?: number;
  tts_provider?: string;
}

export interface SessionInfo {
  id: string;
  source: string | null;
  model: string | null;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  last_active: number;
  is_active: boolean;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  preview: string | null;
  pinned?: boolean;
  /** 1 quando há entrega autônoma (rotina) não vista nesta conversa. */
  unread?: number;
  /** Pasta do projeto da conversa — a sidebar agrupa por ela. */
  project_dir?: string;
  /** Última pasta do caminho, para o cabeçalho do grupo. */
  project_name?: string;
  /** Modo do workspace da conversa ("" = sem modo → tratar como "inicio"). */
  run_mode?: string;
  pinned_at?: number | null;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
  estimated_cost_usd?: number | null;
  actual_cost_usd?: number | null;
  cost_status?: string | null;
  cost_source?: string | null;
  api_call_count?: number;
}

export interface SessionModelUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  cost_status: string;
}

export interface SessionUsageSummary {
  message_count: number;
  models: string[];
  /** Custo/tokens por modelo (quando a conversa usou mais de um). */
  by_model: SessionModelUsage[];
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  api_call_count: number;
  tool_call_count: number;
  cost_usd: number | null;
  cost_status: string;
}

export interface SessionDetailResponse extends SessionInfo {
  usage_summary: SessionUsageSummary;
}

export interface PaginatedSessions {
  sessions: SessionInfo[];
  total: number;
  limit: number;
  offset: number;
}

export type MemoryTarget = "memory" | "user";

/** Quem escreveu a entrada — "user" = criada por você no dashboard. */
export type MemoryOrigin = "user" | "agent";

export interface MemoryEntry {
  id: string;
  target: MemoryTarget;
  /** Texto completo como está no disco (inclui o carimbo [YYYY-MM]). */
  content: string;
  /** Texto sem o carimbo — para exibição. Inclui a linha do título. */
  body: string;
  /** Título (`# ...` na primeira linha) ou "" quando a entrada não tem. */
  title: string;
  /** Corpo sem carimbo E sem a linha do título — o que o editor edita. */
  text: string;
  /** Mês de gravação (YYYY-MM) ou null para entradas antigas. */
  stamp: string | null;
  /** Alvos de [[wikilinks]] mencionados no texto. */
  links: string[];
  /** #tags mencionadas no texto. */
  tags: string[];
  /** `@pasta` — projetos onde a memória vale. Vazio = vale em todos. */
  scopes: string[];
  /** Procedência (sidecar no backend; ausente = escrita do agente). */
  origin: MemoryOrigin;
  /**
   * Última vez que o agente LEU esta memória (ISO 8601, UTC).
   *
   * `null` = nunca foi lida desde que o registro passou a existir — o que não
   * é o mesmo que "inútil": pode só não ter havido ocasião.
   */
  last_access?: string | null;
}

export interface MemoryTargetData {
  entries: MemoryEntry[];
  used_chars: number;
  limit_chars: number;
}

/** Uma tag do cérebro: quantas memórias a usam e o que ela significa. */
export interface MemoryTag {
  tag: string;
  /** Vazio enquanto ninguém descreveu — é o que o dashboard destaca. */
  description: string;
  /**
   * Descrição DERIVADA: as tags que mais aparecem junto desta. Existe porque
   * a maioria das tags nasce inline, no texto da memória, e nunca passa por
   * cadastro — sem isto elas ficariam opacas tanto para o agente quanto aqui.
   * Nunca substitui `description`; é o que se mostra na falta dela.
   */
  related: string[];
  /** Diretórios em que as memórias desta tag valem. Vazio = todos. */
  scopes: string[];
  count: number;
}

export interface MemoryResponse {
  memory: MemoryTargetData;
  user: MemoryTargetData;
  /** Catálogo de tags, mais usadas primeiro. */
  tags: MemoryTag[];
}

/** Formato de troca — o que sai no export e entra no import. */
export interface MemoryExportEntry {
  target: MemoryTarget;
  content: string;
  origin: MemoryOrigin;
}

/** Descrição de tag no arquivo de troca (v2+). */
export interface MemoryExportTag {
  tag: string;
  description: string;
  scopes?: string[];
}

export interface MemoryExport {
  version: number;
  exported_at: string;
  count: number;
  entries: MemoryExportEntry[];
  /** Ausente em arquivos v1. */
  tags?: MemoryExportTag[];
}

export interface MemoryImportResult {
  ok: boolean;
  imported: number;
  /** Descrições de tag restauradas (0 em arquivos v1). */
  tags_imported: number;
  /** Recusadas (duplicata, scan, limite) — o lote não aborta por causa delas. */
  skipped: Array<{ content: string; reason: string }>;
}

export interface CamofoxStatus {
  installed: boolean;
  running: boolean;
  /** stopped | installing | starting | running | error */
  state: string;
  managed: boolean;
  url: string;
  port: number;
  idle_timeout_minutes: number;
  node_available: boolean;
  error: string;
}

export interface EnvVarInfo {
  is_set: boolean;
  redacted_value: string | null;
  description: string;
  url: string | null;
  category: string;
  is_password: boolean;
  tools: string[];
  advanced: boolean;
  deprecated: boolean;
}

export interface SessionMessageAttachment {
  id: string;
  name: string;
  url: string;
}

export interface SessionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  attachments?: SessionMessageAttachment[];
  tool_calls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  tool_name?: string;
  tool_call_id?: string;
  timestamp?: number;
  /** Raciocínio persistido do turno (o banco guarda nos dois campos). */
  reasoning?: string | null;
  reasoning_content?: string | null;
  /** Tokens REAIS do turno (input+output), gravados na última mensagem do
   *  assistente. Presente só quando o backend mediu o uso do turno. */
  turn_tokens?: number | null;
}

export interface SessionMessagesResponse {
  session_id: string;
  messages: SessionMessage[];
}

export interface SessionChapter {
  id: number;
  session_id: string;
  title: string;
  summary: string | null;
  created_at: number;
}

export interface SessionChaptersResponse {
  session_id: string;
  chapters: SessionChapter[];
}

export interface LogsResponse {
  file: string;
  lines: string[];
}

export interface AnalyticsDailyEntry {
  day: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  sessions: number;
  api_calls: number;
}

export interface AnalyticsModelEntry {
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  sessions: number;
  api_calls: number;
}

export interface AnalyticsSkillEntry {
  skill: string;
  view_count: number;
  manage_count: number;
  total_count: number;
  percentage: number;
  last_used_at: number | null;
}

export interface AnalyticsSkillsSummary {
  total_skill_loads: number;
  total_skill_edits: number;
  total_skill_actions: number;
  distinct_skills_used: number;
}

export interface AnalyticsToolEntry {
  tool: string;
  count: number;
  percentage: number;
}

export interface AnalyticsResponse {
  daily: AnalyticsDailyEntry[];
  by_model: AnalyticsModelEntry[];
  totals: {
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_reasoning: number;
    total_estimated_cost: number;
    total_actual_cost: number;
    total_sessions: number;
    total_api_calls: number;
  };
  skills: {
    summary: AnalyticsSkillsSummary;
    top_skills: AnalyticsSkillEntry[];
  };
  tools: AnalyticsToolEntry[];
}

export interface CronJob {
  id: string;
  name?: string;
  prompt: string;
  schedule: { kind: string; expr: string; display: string };
  schedule_display: string;
  enabled: boolean;
  state: string;
  deliver?: string;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_error?: string | null;
}

export interface CronSchedulePreview {
  valid: boolean;
  kind?: string;
  schedule?: string;
  description?: string;
  next_runs?: string[];
  error?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  editable?: boolean;
}

export interface SkillContentResponse {
  name: string;
  content: string;
  path?: string;
}

export interface SkillCreateRequest {
  name: string;
  content: string;
  category?: string;
}

export interface SkillMutationResponse {
  success: boolean;
  message?: string;
  path?: string;
  error?: string;
}

export interface OpenRouterModelMeta {
  /** true = existe no catálogo; false = não encontrado; null = não deu pra checar (offline). */
  found: boolean | null;
  name?: string;
  context_length?: number | null;
  supports_tools?: boolean;
  supports_vision?: boolean;
  free?: boolean;
}

export interface ToolsetInfo {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  tools: string[];
  /** Chaves de ambiente que configuram o toolset (1ª = a principal). Usada pelo
   *  card pendente para nomear a chave e focar nela no /env. */
  env_keys?: string[];
}

export interface SessionSearchResult {
  session_id: string;
  snippet: string;
  role: string | null;
  source: string | null;
  model: string | null;
  session_started: number | null;
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
}

// ── Projects / folder picker ───────────────────────────────────────────

export interface RecentProject {
  path: string;
  path_label: string;
  opened_at: number;
}

export interface RecentProjectsResponse {
  projects: RecentProject[];
}

export interface FsBrowseEntry {
  name: string;
  path: string;
  path_label: string;
  is_dir: boolean;
}

export interface FsBrowseResponse {
  path: string;
  path_label: string;
  parent: string | null;
  entries: FsBrowseEntry[];
}

export interface OpenProjectResponse extends GitFooterFields {
  cwd: string;
  cwd_label: string;
}

// ── Model info types ──────────────────────────────────────────────────

export interface ChatContextResponse extends GitFooterFields {
  model: string;
  model_label: string;
  provider: string;
  cwd: string;
  cwd_label: string;
  /** Mirrors ``display.show_cost`` from config. */
  show_cost?: boolean;
  cost_usd?: number;
  cost_status?: string;
  agent_mode?: ComposerAgentMode;
  agent_mode_label?: string;
  /** Modo Início/Code escolhido ("inicio"|"code"|"automatico"). */
  run_mode?: string;
  /** No Automático, o modo EFETIVO que o Super Notepad resolveu no último turno. */
  effective_run_mode?: string;
  effective_run_mode_label?: string;
  has_plan?: boolean;
  plan_display_path?: string;
}

export interface ChatPlanResponse {
  ok: boolean;
  session_id?: string;
  content: string;
  display_path?: string;
  relative_path?: string;
  path?: string;
}

export type ComposerAgentMode = "agent" | "plan";

export interface ChatImagePayload {
  filename?: string;
  mime?: string;
  content_base64: string;
}

export interface ChatDocumentPayload {
  filename?: string;
  mime?: string;
  content_base64: string;
}

export interface ChatSendRequest {
  session_id?: string;
  message?: string;
  images?: ChatImagePayload[];
  documents?: ChatDocumentPayload[];
  model?: string;
  provider?: string;
  mode?: ComposerAgentMode;
}

export interface ChatApprovalRequest {
  session_id: string;
  /** `exact`: autoriza para sempre APENAS este comando literal. */
  choice: "approve" | "deny" | "once" | "session" | "always" | "exact";
  all?: boolean;
}

export interface ChatApprovalResponse {
  ok: boolean;
  resolved: number;
}

export interface ChatStatusResponse {
  session_id: string;
  busy: boolean;
  pending_approval: boolean;
  pending_wiser: boolean;
}

export interface ChatLiveToolCall {
  id: string;
  server_id?: string;
  name: string;
  args?: string;
  live_label?: string;
  live_technical?: string;
  result?: string | null;
  status?: "running" | "complete" | "error";
  cwd?: string | null;
  background_proc_id?: string;
}

export interface ChatLiveTurn {
  revision: number;
  request_id?: string;
  status_text?: string;
  streaming_buffer?: string;
  tool_calls?: ChatLiveToolCall[];
  segments?: Array<{
    kind: "text" | "tools" | "attachments";
    content?: string;
    tool_calls?: ChatLiveToolCall[];
    attachments?: SessionMessageAttachment[];
  }>;
}

export interface ChatTurnResponse {
  session_id: string;
  busy: boolean;
  revision: number;
  pending_approval: boolean;
  pending_wiser: boolean;
  messages: SessionMessage[];
  live: ChatLiveTurn | null;
}

export interface ChatActiveSessionsResponse {
  sessions: string[];
}

export interface ChatBackgroundProcess {
  session_id: string;
  command: string;
  cwd: string;
  pid: number;
  started_at: string;
  uptime_seconds: number;
  status: "running" | "exited";
  output_preview: string;
  exit_code?: number;
  detached?: boolean;
}

export interface ChatBackgroundProcessesResponse {
  session_id: string;
  processes: ChatBackgroundProcess[];
}

/** Terminal integrado do painel (PTY vivo no servidor, escopado à conversa). */
export interface TerminalInfo {
  id: string;
  title: string;
  cwd: string;
  alive: boolean;
  /** Título definido pelo usuário (rename) — vs. o nome inteligente. */
  custom?: boolean;
  created_at?: number;
}

export interface GitPrStatus {
  dir_name: string;
  workspace_defined: boolean;
  repo_name: string;
  branch: string | null;
  base_branch: string | null;
  diff_insertions: number;
  diff_deletions: number;
  needs_attention: boolean;
  github_owner: string | null;
  github_repo: string | null;
  ahead: number;
  behind: number;
  modified: number;
  untracked: number;
}

export interface GitChangeFile {
  path: string;
  old_path?: string;
  status: string;
  label: string;
  staged?: boolean;
  /** Repo git aninhado (monorepo) dono do arquivo, relativo à raiz. "" = raiz. */
  repo?: string;
  /** Linhas adicionadas/removidas (git --numstat). Ausente = sem selo. */
  additions?: number;
  deletions?: number;
}

export interface GitChangesResponse {
  is_repo: boolean;
  dir_name: string;
  branch: string | null;
  ahead: number;
  has_upstream: boolean;
  /** Alterações não commitadas (working tree). */
  working: GitChangeFile[];
  /** Arquivos de commits à frente do upstream (commitados, não enviados). */
  unpushed: GitChangeFile[];
}

export interface ChatApprovalPendingResponse {
  pending: boolean;
  command?: string;
  description?: string;
  intent?: string;
}

export interface ChatWiserRequest {
  session_id: string;
  answer: string;
}

export interface ChatWiserResponse {
  ok: boolean;
  resolved: number;
}

export interface ChatWiserPendingResponse {
  pending: boolean;
  question?: string;
  choices?: string[];
  request_id?: string;
}

export interface ChatYoloResponse {
  ok: boolean;
  enabled: boolean;
  message: string;
}

export interface ChatAgentModeResponse {
  ok: boolean;
  mode: ComposerAgentMode;
  label: string;
}

export interface ChatTranscribeRequest {
  audio_base64: string;
  mime?: string;
  filename?: string;
}

export interface ChatTranscribeResponse {
  success: boolean;
  transcript: string;
}

export interface ModelOptionProvider {
  slug: string;
  name: string;
  is_current?: boolean;
  is_user_defined?: boolean;
  models?: string[];
  total_models?: number;
  warning?: string;
  source?: string;
}

/** Capacidades de um modelo (models.dev): ferramentas, visão, raciocínio. */
export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
}

export interface ModelOptionsResponse {
  model?: string;
  provider?: string;
  providers?: ModelOptionProvider[];
  /** Capacidades por `slug/modelId` — badges no seletor. */
  capabilities?: Record<string, ModelCapabilities>;
}

export interface ModelInfoResponse extends GitFooterFields {
  model: string;
  provider: string;
  /** Rodapé do composer (opcional — servidor recente). */
  model_label?: string;
  cwd?: string;
  cwd_label?: string;
  auto_context_length: number;
  config_context_length: number;
  effective_context_length: number;
  capabilities: {
    supports_tools?: boolean;
    supports_vision?: boolean;
    supports_reasoning?: boolean;
    context_window?: number;
    max_output_tokens?: number;
    model_family?: string;
  };
}

// ── Custom integration types ───────────────────────────────────────────

export interface CustomIntegration {
  id: string;
  name: string;
  base_url: string;
  auth_type: string;
  auth_hint: string;
  username: string;
  api_key_header: string;
  /** Playbook de como operar a API (mini-skill da integração). */
  guide?: string;
  /** Tem ícone da marca cacheado? (serve por /api/.../icon). */
  has_icon?: boolean;
  pending: boolean;
  created_at: number;
  custom: true;
}

// ── Dashboard theme types ──────────────────────────────────────────────
