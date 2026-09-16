/**
 * Notificações nativas quando o painel roda dentro do app desktop.
 *
 * No navegador isto é inteiramente inerte: o prefixo «(Concluído)» no título
 * da aba cobre o caso, e pedir permissão de Notification sem o usuário ter
 * pedido nada é intrusivo. No app desktop existe uma ponte IPC, e é ela que
 * usamos.
 *
 * A regra que mais importa aqui é a de silêncio: **só notifica quando a
 * janela não está em uso**. Uma notificação de sistema enquanto a pessoa
 * olha para a resposta chegando não informa nada — só interrompe.
 */

import { fetchJSON } from "@/lib/api";
import { getNestedValue } from "@/lib/nested";
import { pushNotification } from "@/lib/notificationCenter";
import {
  approvalCopy,
  questionCopy,
  summarizeReply,
  turnCompleteCopy,
} from "@/lib/notificationCopy";
import { readCachedMessages } from "@/pages/ChatPage/chatMessageCache";
import { buildDisplaySegments } from "@/pages/ChatPage/chatDisplaySegments";
import { shouldShowTimelineTextRow } from "@/pages/ChatPage/reasoningLabels";

type NotifyRequest = {
  title: string;
  body: string;
  tag?: string;
  /** Ignora o bloqueio por foco — para avisos que devem tocar mesmo com a
   * janela à frente (ex.: um lembrete que o usuário agendou). */
  force?: boolean;
};

type TauriCore = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Mesma janela do sino, pelo mesmo motivo: o fim de um turno é anunciado
 * pelo fim do stream SSE e pelo watcher global, e qual chega primeiro varia.
 */
const DEDUP_MS = 2500;

/**
 * Janela MAIOR só para o fim de turno. O watcher global espera ~3s de grace +
 * o intervalo do poll (2s) antes de confirmar que o turno morreu, então o 2º
 * anúncio chega BEM depois do 1º (SSE DONE) — mais que os 2,5s do DEDUP_MS, e
 * saía uma notificação a mais (com o resumo já consumido, virava o texto
 * genérico "Terminei essa"). 15s cobre o gap com folga; dois turnos DISTINTOS
 * terminando nesse intervalo com o usuário ausente é caso raro (e o segundo
 * ping seria só barulho — o resultado está na conversa de qualquer forma).
 */
const TURN_COMPLETE_DEDUP_MS = 15_000;

const lastSentAt = new Map<string, number>();

/**
 * Apelido usado no vocativo. É estado do app inteiro e muda raramente, então
 * fica aqui em vez de ser passado em cada chamada — o `ChatTurnProvider`
 * escreve quando a config carrega.
 */
let nickname: string | undefined;

export function setNotificationNickname(value: string | undefined): void {
  nickname = value?.trim() || undefined;
}

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
 * Sincroniza o título da janela NATIVA (barra do sistema) com o do painel.
 * No navegador não faz nada — a aba já usa `document.title`.
 */
export function setDesktopWindowTitle(title: string): void {
  const core = tauriCore();
  if (!core || !title.trim()) return;
  void core.invoke("set_window_title", { title }).catch(() => {
    // Janela sem o comando (versão antiga do app); nada a fazer daqui.
  });
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

/**
 * Abre o diálogo nativo "salvar como" (desktop) e devolve o caminho escolhido,
 * ou null se cancelar / não estiver no app. Usado pelo export do Backup: como o
 * painel roda na mesma máquina, o servidor grava o zip direto nesse caminho.
 */
export async function pickSavePath(
  defaultName: string,
): Promise<string | null> {
  const core = tauriCore();
  if (!core) return null;
  try {
    const path = await core.invoke("pick_save_path", { defaultName });
    return typeof path === "string" && path ? path : null;
  } catch {
    return null;
  }
}

/**
 * Abre o seletor NATIVO de pasta (desktop) e devolve o caminho escolhido, ou
 * null se cancelar / não estiver no app. Usado pelo "Abrir pasta" do chat.
 */
export async function pickFolderPath(): Promise<string | null> {
  const core = tauriCore();
  if (!core) return null;
  try {
    const path = await core.invoke("pick_folder_path");
    return typeof path === "string" && path ? path : null;
  } catch {
    return null;
  }
}

import { openAppWindow } from "@/lib/openAppWindow";

/** Evento interno: navegação pedida pelo menu da bandeja (Tauri → React Router). */
export const APP_NAVIGATE_EVENT = "supernotepad:navigate";
/** Bandeja / ícone vermelho pediu para parar a gravação Eco. */
export const APP_ECO_STOP_EVENT = "supernotepad:eco-stop";

/**
 * Liga o menu da bandeja ao React Router. O Tauri dispara `supernotepad:navigate`;
 * `pushState` + `popstate` sintético sozinho não atualiza o Router de forma
 * confiável.
 *
 * Eco abre em janela de app (`panel=1`), sem auto-gravar.
 */
export function installTrayNavigation(
  navigate: (path: string, opts?: { state?: unknown; replace?: boolean }) => void,
): () => void {
  const onNav = (e: Event) => {
    const path = (e as CustomEvent<{ path?: string }>).detail?.path;
    if (typeof path !== "string" || !path.startsWith("/")) return;
    if (path === "/eco" || path.startsWith("/eco?") || path.startsWith("/eco/")) {
      // Remove record=1 legado — abrir ≠ gravar.
      const cleaned = path.replace(/([?&])record=1&?/, "$1").replace(/[?&]$/, "");
      void openAppWindow(cleaned || "/eco");
      return;
    }
    // "Novo chat" da bandeja: `/chat` puro é no-op quando a janela JÁ está em
    // /chat (mesma rota) — não abria um chat novo. O `state.resetLanding` faz o
    // ChatPage resetar pra uma conversa nova mesmo já estando lá.
    if (path === "/chat") {
      navigate("/chat", { state: { resetLanding: true } });
      return;
    }
    navigate(path);
  };
  window.addEventListener(APP_NAVIGATE_EVENT, onNav);
  return () => window.removeEventListener(APP_NAVIGATE_EVENT, onNav);
}

/** Mostra/esconde a bolinha vermelha ao lado do ícone do Super Notepad na bandeja. */
export function setEcoRecordingTray(active: boolean): void {
  const core = tauriCore();
  if (!core) return;
  void core.invoke("set_eco_recording", { active }).catch(() => {});
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
 * Manter o Super Notepad rodando em segundo plano ao fechar a janela.
 *
 * Ligado, fechar a janela apenas a esconde — o servidor e o agendador de
 * tarefas (sincronização de e-mail etc.) seguem vivos, e a bandeja traz a
 * janela de volta. Vale já e no próximo arranque. No navegador é no-op.
 */
export function setKeepBackground(enabled: boolean): void {
  const core = tauriCore();
  if (!core) return;
  void core.invoke("set_keep_background", { enabled }).catch(() => {});
}

export async function getKeepBackground(): Promise<boolean> {
  const core = tauriCore();
  if (!core) return false;
  try {
    return Boolean(await core.invoke("get_keep_background"));
  } catch {
    return false;
  }
}

/** Abre os ajustes do SO na seção pedida (concessão é do usuário, não do app). */
export function openOsSettings(
  section: "notifications" | "login-items" | "files" | "screen-recording",
): void {
  const core = tauriCore();
  if (!core) return;
  void core.invoke("open_os_settings", { section }).catch(() => {});
}

/**
 * Dispara uma notificação de teste — ignora o bloqueio por foco de propósito,
 * para o usuário ver o resultado (e o SO pedir a permissão na primeira vez)
 * mesmo com a janela à frente. Resolve para uma mensagem de erro do sistema,
 * ou `null` em caso de sucesso.
 */
export async function sendTestNotification(): Promise<string | null> {
  const core = tauriCore();
  if (!core) return "Disponível apenas no app desktop.";
  try {
    await core.invoke("notify", {
      request: {
        title: "Super Notepad",
        body: "Notificações ativadas — você será avisado sobre e-mails e respostas.",
        force: true,
      },
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
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
 * Ações do sistema sobre a pasta do projeto.
 *
 * Só existem no app: revelar no gerenciador de arquivos e abrir um terminal
 * pedem acesso ao sistema, e a página sozinha não tem. No navegador os itens
 * do menu nem aparecem — `isDesktopApp` é o que decide.
 */
export function revealPathInFileManager(path: string): void {
  const core = tauriCore();
  if (!core || !path.trim()) return;
  void core.invoke("reveal_path", { path }).catch(() => {
    // Caminho recusado pela validação do app; nada a fazer daqui.
  });
}

export function openTerminalAtPath(path: string): void {
  const core = tauriCore();
  if (!core || !path.trim()) return;
  void core.invoke("open_terminal", { path }).catch(() => {
    // Sem emulador de terminal, ou caminho recusado.
  });
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

function send(request: NotifyRequest): void {
  const core = tauriCore();
  if (!core) return;
  void core.invoke("notify", { request }).catch(() => {
    // Sistema pode ter negado a permissão; não vale quebrar o chat por isso.
  });
}

/**
 * Deixa passar quando estamos no app e o mesmo evento não acabou de sair.
 *
 * Note que o foco da janela NÃO é decidido aqui. `document.hasFocus()` não
 * acompanha de forma confiável o foco da janela nativa numa WKWebView — com
 * o app em segundo plano ele já reportou a janela em uso e engoliu a
 * notificação. Quem responde isso é o lado Rust, que pergunta ao sistema de
 * janelas. Aqui sobra o que a página realmente sabe: se há ponte e se o
 * evento é repetido.
 */
function shouldSend(key: string, windowMs: number = DEDUP_MS): boolean {
  if (!isDesktopApp()) return false;

  const now = Date.now();
  const last = lastSentAt.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  lastSentAt.set(key, now);

  // Poda: sem isto o mapa cresce uma entrada por sessão para sempre. Usa a MAIOR
  // janela em uso (o fim de turno usa 15s) — podar antes disso reabriria a porta
  // para a notificação duplicada que a janela existe para barrar.
  if (lastSentAt.size > 64) {
    for (const [entry, at] of lastSentAt) {
      if (now - at >= TURN_COMPLETE_DEDUP_MS) lastSentAt.delete(entry);
    }
  }

  return true;
}

/**
 * O texto é em primeira pessoa, como o agente falaria.
 *
 * A versão anterior dizia «O Super Notepad terminou o turno»: fala de si na terceira
 * pessoa, e «turno» é vocabulário nosso — quem usa não pensa em turnos, pensa
 * numa resposta que estava esperando.
 *
 * Quando há título de conversa, ele vira o TÍTULO da notificação, não o
 * corpo: é a linha que o sistema mostra em negrito e a única que sobrevive
 * inteira num banner estreito. Quem tem três conversas rodando precisa
 * primeiro saber QUAL terminou.
 */
/**
 * Resumo do FECHAMENTO do turno.
 *
 * Uma mensagem do agente não é um texto só: ela é uma sequência de segmentos
 * — falas intermediárias («Vou ver o status do repositório antes de
 * commitar»), chamadas de ferramenta, e por fim a resposta. Ler o `content`
 * da mensagem pegava uma dessas falas do meio, e a notificação anunciava a
 * intenção em vez do resultado: dizia que ia verificar o repositório num
 * turno que já tinha feito commit e push.
 *
 * O certo é o ÚLTIMO segmento de texto visível — o mesmo que a tela mostra
 * como fecho. `buildDisplaySegments` e `shouldShowTimelineTextRow` são os
 * mesmos usados pela timeline, para as duas nunca discordarem sobre qual é a
 * resposta.
 */
function lastReplySummary(sessionId: string): string | undefined {
  try {
    const mensagens = readCachedMessages(sessionId);

    for (let i = mensagens.length - 1; i >= 0; i -= 1) {
      const msg = mensagens[i];
      if (msg.role !== "assistant") continue;

      const fecho = lastVisibleText(msg);
      if (fecho) return summarizeReply(fecho);
    }
  } catch {
    // Cache indisponível — a cópia canônica cobre.
  }
  return undefined;
}

function lastVisibleText(msg: Parameters<typeof buildDisplaySegments>[0]): string | undefined {
  const segmentos = buildDisplaySegments(msg);

  for (let i = segmentos.length - 1; i >= 0; i -= 1) {
    const seg = segmentos[i];
    if (seg.kind !== "text") continue;
    const texto = seg.content.trim();
    if (texto && shouldShowTimelineTextRow(texto)) return texto;
  }

  // Mensagem sem segmentos (histórico antigo do servidor): o corpo é o texto.
  const conteudo = (msg.content ?? "").trim();
  return segmentos.length === 0 && conteudo ? conteudo : undefined;
}

/**
 * Resumo do turno escrito pela LLM (evento SSE `NOTIFICATION_SUMMARY`), por
 * sessão. Chega ANTES do DONE; o DONE é o que dispara a notificação. Preferido
 * ao resumo heurístico — é ele que diz, de verdade, o que o agente fez.
 */
const llmTurnSummary = new Map<string, string>();

/** Guarda o resumo da LLM para a próxima notificação de conclusão da sessão. */
export function setTurnNotificationSummary(
  sessionId: string,
  summary: string,
): void {
  const sid = sessionId.trim();
  const texto = summary.trim();
  if (!sid || !texto) return;
  llmTurnSummary.set(sid, texto);
  // Poda simples: sem isto o mapa cresceria uma entrada por sessão.
  if (llmTurnSummary.size > 64) {
    const primeiro = llmTurnSummary.keys().next().value;
    if (primeiro && primeiro !== sid) llmTurnSummary.delete(primeiro);
  }
}

/** Lê E remove — cada resumo vale por UM turno, para não vazar para o próximo. */
function consumeTurnSummary(sid: string): string | undefined {
  const texto = llmTurnSummary.get(sid);
  if (texto !== undefined) llmTurnSummary.delete(sid);
  return texto;
}

// Momento do último fim de turno anunciado COM resumo. O SSE DONE (que tem o
// resumo) e o watcher global anunciam o mesmo turno com session ids às vezes
// DIFERENTES — aí o dedup por sid não os une e sai um par, o 2º genérico (o
// resumo já foi consumido pelo 1º). Um "concluído" SEM resumo logo depois de um
// informativo é essa duplicata redundante, e é o que suprimimos. Não afeta duas
// sessões distintas terminando genéricas: nenhuma marca este relógio.
let lastInformativeTurnCompleteAt = 0;

export function notifyTurnComplete(sessionId: string, label?: string): void {
  const sid = sessionId.trim();
  if (!sid) return;
  // Janela longa: o SSE DONE e o watcher global anunciam o MESMO fim de turno
  // com vários segundos de diferença; sem isto saíam duas (a 2ª já sem o resumo).
  if (!shouldSend(`complete:${sid}`, TURN_COMPLETE_DEDUP_MS)) return;

  // A LLM resume o turno (o que foi FEITO); só sem ela cai na extração
  // heurística da última fala, e daí na frase canônica. O resumo vem em
  // markdown (`código`, **negrito**) — o banner do SO e a central mostram texto
  // cru, então achata como as demais notificações (aprovação/pergunta) fazem.
  const resumoRaw = consumeTurnSummary(sid) ?? lastReplySummary(sid);
  const resumo = resumoRaw ? plainPreview(resumoRaw) : resumoRaw;

  const now = Date.now();
  if (
    !resumo &&
    lastInformativeTurnCompleteAt &&
    now - lastInformativeTurnCompleteAt < TURN_COMPLETE_DEDUP_MS
  ) {
    return; // duplicata genérica do informativo recém-enviado
  }
  if (resumo) lastInformativeTurnCompleteAt = now;
  send({
    ...turnCompleteCopy(label, resumo),
    // Identifica a conversa: no macOS o lado nativo usa esta tag como
    // identifier do UNUserNotificationCenter, então o próximo turno concluído
    // da MESMA conversa SUBSTITUI o aviso anterior em vez de empilhar (e o
    // threadIdentifier os agrupa). Ver desktop/src-tauri/src/notify.rs.
    tag: `sessao:${sid}`,
  });
}

/**
 * Limpa markdown de uma prévia para virar texto de notificação legível: cabeçalho
 * de mensagem do assistente vem em markdown (`**negrito**`, listas `- `, `#`), e
 * cru fica feio no banner do SO e na central. Achata pra uma linha só.
 */
export function plainPreview(md: string): string {
  return (md || "")
    .replace(/```[\s\S]*?```/g, " ") // blocos de código
    .replace(/`([^`]+)`/g, "$1") // código inline
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // imagens
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → texto
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // cabeçalhos #
    .replace(/^\s{0,3}>\s?/gm, "") // citações
    .replace(/^\s*[-*+]\s+/gm, "• ") // bullets → •
    .replace(/^\s*\d+\.\s+/gm, "") // listas numeradas
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // negrito
    .replace(/(\*|_)(.*?)\1/g, "$2") // itálico
    .replace(/~~(.*?)~~/g, "$1") // riscado
    .replace(/\s*\n\s*/g, "  ") // quebras → espaço
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Notificação de uma ENTREGA AUTÔNOMA (rotina de cron entregue no painel numa
 * conversa que o usuário não está vendo). Usa a prévia da mensagem direto —
 * não depende do cache da sessão ativa. Ver docs/dashboard-autonomous-delivery.md.
 */
export function notifyDelivery(
  sessionId: string,
  title?: string | null,
  preview?: string | null,
): void {
  const sid = (sessionId || "").trim();
  if (!sid) return;
  const corpo = plainPreview((preview || "").trim());
  const titulo = (title || "").trim() || "Super Notepad";
  const texto = corpo || "Nova mensagem do Super Notepad";
  // Registra na central (com deeplink) mesmo quando a notificação do SO é
  // suprimida por foco — é justo o que o usuário quer rever depois. O TÍTULO da
  // central é humano: o nome da conversa quando há; senão uma frase, nunca só
  // "Super Notepad".
  pushNotification({
    kind: "delivery",
    title: (title || "").trim() || "Nova mensagem do Super Notepad",
    body: texto,
    target: `/chat?resume=${encodeURIComponent(sid)}`,
  });
  if (!shouldSend(`delivery:${sid}:${corpo.slice(0, 40)}`)) return;
  send({ title: titulo, body: texto, tag: `sessao:${sid}` });
}

/**
 * Um LEMBRETE chegou na hora marcada. Diferente das outras notificações, um
 * lembrete é um alarme que o usuário agendou — deve tocar mesmo com a janela
 * à frente (`force`), senão o aviso que ele pediu passa despercebido. A cadência
 * (avisar uma vez só) é garantida pelo selo `notified` no servidor, gravado por
 * quem chama (`useReminderNotifications`).
 */
export function notifyReminder(
  id: string,
  text: string,
  opts?: { os?: boolean },
): void {
  const corpo = (text || "").trim();
  if (!corpo) return;
  // Central: o título é o próprio lembrete (humano), não a etiqueta "Lembrete".
  pushNotification({
    kind: "reminder",
    title: `Lembrete: ${corpo}`,
    body: "",
    target: "/lembretes",
    // Carimba o id do lembrete na entrada da central — permite removê-la quando
    // o lembrete é apagado (hygiene: `removeNotificationsForReminder` /
    // `reconcileReminderNotifications`).
    dedupKey: `reminder:${id}`,
  });
  // `os: false` → só registra na central, sem tocar a notificação do SO. É o
  // que o backlog usa: N lembretes vencidos de uma vez viram UM aviso agregado
  // em vez de N pop-ups simultâneos.
  if (opts?.os === false) return;
  if (!shouldSend(`reminder:${id}`)) return;
  send({ title: "Lembrete", body: corpo, tag: `lembrete:${id}`, force: true });
}

/**
 * Aviso AGREGADO do backlog: vários lembretes venceram com o app fechado e
 * tocam juntos ao reabrir. Um pop-up só ("N lembretes venceram") em vez de um
 * por lembrete — os individuais já foram pra central. `force` como o lembrete.
 */
export function notifyRemindersBacklog(count: number): void {
  const n = Math.max(0, Math.floor(count));
  if (n <= 0) return;
  const body = nickname
    ? `${nickname}, ${n} lembretes venceram enquanto você esteve fora.`
    : `${n} lembretes venceram enquanto você esteve fora.`;
  send({ title: "Lembretes", body, tag: "lembretes-backlog", force: true });
}

/**
 * Chegou e-mail novo (sincronização em segundo plano). Notificação AGREGADA,
 * não uma por mensagem: um resumo "você tem N e-mails não lidos". Uma por
 * mensagem virava spam — três e-mails, três pop-ups iguais. A cadência (não
 * repetir sem parar) é responsabilidade de quem chama (`useMailNotifications`);
 * aqui só formatamos. A tag comum "email" faz o sistema substituir a anterior.
 */
export function notifyUnreadMail(count: number): void {
  const n = Math.max(0, Math.floor(count));
  if (n <= 0) return;
  const noun = n === 1 ? "e-mail não lido" : "e-mails não lidos";
  const body = nickname
    ? `${nickname}, você tem ${n} ${noun}.`
    : `Você tem ${n} ${noun}.`;
  // Central: título humano ("Você tem 3 e-mails não lidos"), não "E-mails".
  pushNotification({
    kind: "mail",
    title: `Você tem ${n} ${noun}`,
    body: "",
    target: "/mail",
  });
  if (!shouldSend(`mail-unread:${n}`)) return;
  send({ title: "E-mails", body, tag: "email" });
}

/**
 * Transcrição Eco terminou. Avisa mesmo que o resumo ainda esteja rodando —
 * a espera longa é a do áudio → texto.
 *
 * `force`: como o lembrete, é a conclusão de um trabalho LONGO que o usuário
 * disparou e está esperando — e o resultado abre em OUTRA janela (`panel-eco`).
 * Sem `force`, a supressão por foco (que só conhece a janela principal) engolia
 * o aviso sempre que a principal estava à frente durante o processamento, ainda
 * que o usuário não estivesse olhando a gravação. Um "ficou pronto" tardio tem
 * que tocar.
 */
export function notifyEcoTranscribed(
  recId: string,
  title?: string | null,
): void {
  const id = (recId || "").trim();
  if (!id) return;
  const label = (title || "").trim() || "Gravação";
  const body = nickname
    ? `${nickname}, a transcrição de ${label} ficou pronta.`
    : `Transcrição de ${label} pronta.`;
  const target = `/eco/gravacoes/${encodeURIComponent(id)}`;
  // Central: título humano, não a etiqueta "Eco".
  pushNotification({
    kind: "info",
    title: `Transcrição de ${label} pronta`,
    body: "",
    target,
  });
  if (!shouldSend(`eco-transcribe:${id}`)) return;
  send({ title: "Eco", body, tag: `eco:${id}`, force: true });
}

/**
 * Pipeline Eco (transcrever + resumir) terminou. `force` pelo mesmo motivo do
 * `notifyEcoTranscribed`: conclusão de job longo e esperado, resultado em outra
 * janela — não pode ser suprimido por foco da janela principal.
 */
export function notifyEcoReady(recId: string, title?: string | null): void {
  const id = (recId || "").trim();
  if (!id) return;
  const label = (title || "").trim() || "Gravação";
  const body = nickname
    ? `${nickname}, o resumo de ${label} está pronto.`
    : `Resumo de ${label} pronto.`;
  const target = `/eco/gravacoes/${encodeURIComponent(id)}`;
  // Central: título humano, não a etiqueta "Eco".
  pushNotification({
    kind: "info",
    title: `Resumo de ${label} pronto`,
    body: "",
    target,
  });
  if (!shouldSend(`eco-ready:${id}`)) return;
  send({ title: "Eco", body, tag: `eco:${id}`, force: true });
}

export function readNotifyOnNewMailFromConfig(
  config: Record<string, unknown> | null | undefined,
): boolean {
  return readFlag(config, "dashboard.notifications.on_new_mail", true);
}

export function notifyApprovalRequested(label?: string, key?: string): void {
  if (!shouldSend(`approval:${key ?? label ?? ""}`)) return;
  // O detalhe pode vir com markdown (negrito, `código`) — o banner do SO mostra
  // texto puro, então achata antes. Ver notifyQuestionAsked.
  const detalhe = label ? plainPreview(label) : undefined;
  send({ ...approvalCopy(detalhe, nickname), tag: "atencao" });
}

/**
 * Pergunta do agente ao usuário (Wiser). É a outra metade de «precisa de
 * você»: a aprovação pede sim/não sobre uma ação, esta pede uma resposta.
 *
 * Compartilha a tag com a aprovação de propósito — as duas competem pela
 * mesma atenção, e empilhá-las no centro de notificações não ajudaria.
 */
export function notifyQuestionAsked(question: string, key?: string): void {
  // A pergunta do agente vem em markdown ("**Criar** em **Jira**?",
  // "`/rest/api/3/issue`"). O banner do SO e a central mostram texto puro, então
  // achata antes — senão os asteriscos e crases vazam crus para a notificação.
  const text = plainPreview(question);
  if (!text) return;
  if (!shouldSend(`question:${key ?? text}`)) return;
  send({ ...questionCopy(text, nickname), tag: "atencao" });
}

/**
 * Lê uma chave booleana com padrão explícito.
 *
 * `Boolean(undefined)` é `false`, então ler direto faria uma config ainda não
 * gravada desligar a notificação — o oposto do padrão pretendido.
 */
function readFlag(
  config: Record<string, unknown> | null | undefined,
  path: string,
  fallback: boolean,
): boolean {
  const raw = getNestedValue(config ?? {}, path);
  if (raw === undefined || raw === null) return fallback;
  return Boolean(raw);
}

export function readNotifyOnCompleteFromConfig(
  config: Record<string, unknown> | null | undefined,
): boolean {
  return readFlag(config, "dashboard.notifications.on_complete", true);
}

export function readNotifyOnApprovalFromConfig(
  config: Record<string, unknown> | null | undefined,
): boolean {
  return readFlag(config, "dashboard.notifications.on_approval", true);
}

/** @internal Testes */
export function __resetDesktopNotificationsForTests(): void {
  lastSentAt.clear();
  lastInformativeTurnCompleteAt = 0;
}
