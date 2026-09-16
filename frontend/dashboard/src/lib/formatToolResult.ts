import { parseLeadingJsonObject } from "./parseLeadingJson";
import { humanizeWiserUserResponse } from "./wiserMessages";
import {
  extractScriptPathHint,
  humanizeScriptStdout,
} from "./humanizeScriptStdout";
import {
  isUnifiedDiffOutput,
  primaryPathFromDiff,
  shortenToolPath,
} from "./toolActionTitle";
import {
  humanizeKnownToolError,
  inferToolResultStatus as inferOutcomeStatus,
} from "./toolOutcome";

export { humanizeKnownToolError } from "./toolOutcome";

type JsonRecord = Record<string, unknown>;

export interface FriendlyToolResult {
  /** Uma linha — resultado principal no card. */
  headline: string;
  /** Detalhe extra ao expandir; vazio quando o headline basta. */
  detail: string;
}

function parseJsonRecord(raw: string | null | undefined): JsonRecord | null {
  return parseLeadingJsonObject(raw);
}

function clip(text: string, maxLen = 140): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  slack: "Slack",
};

function formatPlatformName(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return PLATFORM_LABELS[key.toLowerCase()] ?? key;
}

function extractPlatformFromTarget(target: string): string | undefined {
  const trimmed = target.trim();
  const colon = trimmed.indexOf(":");
  if (colon > 0) {
    return formatPlatformName(trimmed.slice(0, colon));
  }
  return formatPlatformName(trimmed);
}

interface GatewayPlatformRow {
  key: string;
  label: string;
  state?: string;
  status_text?: string;
}

function isPlatformReady(platform: GatewayPlatformRow): boolean {
  return platform.state === "paired" || platform.state === "configured";
}

function isPlatformPartial(platform: GatewayPlatformRow): boolean {
  return platform.state === "partial";
}

function shortReadyLabel(platform: GatewayPlatformRow): string {
  if (platform.state === "paired") return "pareado";
  if (platform.state === "configured") return "configurado";
  return platformStatusLabel(platform).toLowerCase();
}

function platformStatusLabel(platform: GatewayPlatformRow): string {
  const statusText = asString(platform.status_text);
  if (statusText) return statusText;
  switch (platform.state) {
    case "paired":
      return "Pareado";
    case "configured":
      return "Configurado";
    case "partial":
      return "Configuração parcial";
    case "not_configured":
      return "Não configurado";
    default:
      return platform.state || "Desconhecido";
  }
}

interface PlatformUserCopy {
  connected: string;
  connectedPaused: string;
  configured: string;
  configuredPaused: string;
  partialHeadline: string;
  partialDetail: string;
}

const PLATFORM_USER_COPY: Readonly<Record<string, PlatformUserCopy>> = {
  whatsapp: {
    connected: "WhatsApp conectado",
    connectedPaused: "WhatsApp conectado, mas o envio está pausado",
    configured: "WhatsApp configurado",
    configuredPaused:
      "WhatsApp configurado — ligue o serviço para enviar mensagens",
    partialHeadline: "WhatsApp — falta conectar seu número",
    partialDetail:
      "Abra Canais no menu lateral e escaneie o QR Code para vincular o WhatsApp.",
  },
  telegram: {
    connected: "Telegram conectado",
    connectedPaused: "Telegram conectado, mas o envio está pausado",
    configured: "Telegram configurado",
    configuredPaused:
      "Telegram configurado — ligue o serviço para enviar mensagens",
    partialHeadline: "Telegram — configuração incompleta",
    partialDetail:
      "Abra Canais e informe o token do bot e os usuários permitidos.",
  },
  slack: {
    connected: "Slack conectado",
    connectedPaused: "Slack conectado, mas o envio está pausado",
    configured: "Slack configurado",
    configuredPaused:
      "Slack configurado — ligue o serviço para enviar mensagens",
    partialHeadline: "Slack — configuração incompleta",
    partialDetail: "Abra Canais e informe o token do app Slack.",
  },
};

function platformUserCopy(key: string): PlatformUserCopy | undefined {
  return PLATFORM_USER_COPY[key.toLowerCase()];
}

function userFacingReadyHeadline(
  platform: GatewayPlatformRow,
  gatewayRunning: boolean | undefined,
): string {
  const label = platform.label || formatPlatformName(platform.key) || "Canal";
  const copy = platformUserCopy(platform.key);

  if (copy) {
    if (platform.state === "paired") {
      return gatewayRunning === false ? copy.connectedPaused : copy.connected;
    }
    if (platform.state === "configured") {
      return gatewayRunning === false ? copy.configuredPaused : copy.configured;
    }
  }

  if (platform.state === "paired") {
    return `${label} conectado${gatewayRunning === false ? ", envio pausado" : ""}`;
  }
  if (platform.state === "configured") {
    return `${label} configurado${gatewayRunning === false ? ", envio pausado" : ""}`;
  }

  return `${label} ${shortReadyLabel(platform)}`;
}

function userFacingPartialHeadline(platform: GatewayPlatformRow): string {
  const copy = platformUserCopy(platform.key);
  if (copy) return copy.partialHeadline;
  const label = platform.label || formatPlatformName(platform.key) || "Canal";
  return `${label} — configuração incompleta`;
}

function userFacingPartialDetail(platform: GatewayPlatformRow): string {
  const copy = platformUserCopy(platform.key);
  if (copy) return copy.partialDetail;
  const label = platform.label || formatPlatformName(platform.key) || "Canal";
  return `Conclua a configuração de ${label} em Canais.`;
}

function userFacingIdleHeadline(): string {
  return "Nenhum app de mensagem configurado";
}

function userFacingIdleDetail(platforms: GatewayPlatformRow[]): string {
  const names = platforms.map((p) => p.label).join(", ");
  if (names) {
    return `Você pode configurar ${names} em Canais, no menu lateral.`;
  }
  return "Configure WhatsApp, Telegram ou outros apps em Canais, no menu lateral.";
}

function formatGatewayInspect(data: JsonRecord): FriendlyToolResult {
  const running = asBool(data.gateway_running);
  const platforms = Array.isArray(data.platforms)
    ? (data.platforms as GatewayPlatformRow[]).filter(
      (p) => p && typeof p.label === "string",
    )
    : [];

  const ready = platforms.filter(isPlatformReady);
  const partial = platforms.filter(isPlatformPartial);
  const nextSteps = asStringArray(data.next_steps);

  let headline = "";
  const detailLines: string[] = [];

  if (ready.length === 1) {
    headline = userFacingReadyHeadline(ready[0], running);
  } else if (ready.length > 1) {
    const labels = ready.map((p) => p.label).join(", ");
    headline =
      running === false
        ? `${ready.length} apps conectados · envio pausado`
        : `${ready.length} apps prontos (${labels})`;
  } else if (partial.length === 1) {
    headline = userFacingPartialHeadline(partial[0]);
    detailLines.push(userFacingPartialDetail(partial[0]));
  } else if (partial.length > 1) {
    headline = "Alguns apps precisam de configuração";
    for (const platform of partial) {
      detailLines.push(`• ${userFacingPartialHeadline(platform)}`);
    }
  } else {
    headline = userFacingIdleHeadline();
    detailLines.push(userFacingIdleDetail(platforms));
  }

  if (running === false && ready.length > 0 && !partial.length) {
    detailLines.push(
      "Ligue o serviço de mensagens em Canais para enviar pelo app conectado.",
    );
  }

  for (const step of nextSteps) {
    detailLines.push(step);
  }

  if (data.managed === true) {
    detailLines.push(
      "Instalação gerenciada: configure os apps de mensagem pelo sistema.",
    );
  }

  const gatewayState = asString(data.gateway_state);
  if (
    gatewayState &&
    gatewayState !== "running" &&
    !nextSteps.some((s) => s.toLowerCase().includes(gatewayState.toLowerCase()))
  ) {
    detailLines.push(`Problema no serviço de mensagens: ${gatewayState}.`);
  }

  const uniqueDetail = [...new Set(detailLines.map((line) => line.trim()))].filter(
    Boolean,
  );

  return {
    headline: clip(headline),
    detail: uniqueDetail.join("\n"),
  };
}

function formatSendMessage(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    return { headline: clip(`Falha ao enviar: ${error}`), detail: "" };
  }

  const success = asBool(data.success);
  if (success === true) {
    const platform =
      formatPlatformName(asString(data.platform)) ??
      extractPlatformFromTarget(asString(data.target) ?? "");

    const headline = platform
      ? `Mensagem enviada para o ${platform}`
      : "Mensagem enviada";

    return { headline, detail: "" };
  }

  if (success === false) {
    const message = asString(data.message) || "Não foi possível enviar a mensagem";
    return { headline: clip(message), detail: "" };
  }

  if (Array.isArray(data.targets)) {
    const count = data.targets.length;
    const headline =
      count === 0
        ? "Nenhum destino disponível"
        : count === 1
          ? "1 destino disponível"
          : `${count} destinos disponíveis`;

    const targets = data.targets as JsonRecord[];
    const detailLines = targets.slice(0, 12).map((row) => {
      const label =
        asString(row.label) ||
        asString(row.name) ||
        asString(row.id) ||
        "destino";
      const plat = formatPlatformName(asString(row.platform));
      return plat ? `• ${plat}: ${label}` : `• ${label}`;
    });
    if (targets.length > 12) {
      detailLines.push(`• … e mais ${targets.length - 12}`);
    }

    return { headline, detail: detailLines.join("\n") };
  }

  return { headline: "Enviando mensagem", detail: "" };
}

function formatSendMessageArgsHeadline(rawArgs: string): string | null {
  const parsed = parseJsonRecord(rawArgs);
  if (!parsed) return null;

  const target = asString(parsed.target);
  const platform =
    formatPlatformName(asString(parsed.platform)) ??
    (target ? extractPlatformFromTarget(target) : undefined);

  if (platform) return `Enviando mensagem para o ${platform}`;
  return "Enviando mensagem";
}

function delegateTaskGoalsFromArgs(rawArgs: string): string[] {
  const parsed = parseJsonRecord(rawArgs);
  if (!parsed) return [];

  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const goals: string[] = [];
  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    const goal = asString((task as JsonRecord).goal)?.trim();
    if (goal) goals.push(goal);
  }

  if (goals.length === 0) {
    const single = asString(parsed.goal)?.trim();
    if (single) goals.push(single);
  }

  return goals;
}

/** Headline enquanto `delegate_task` ainda está a correr (só args). */
export function formatDelegateTaskArgsHeadline(rawArgs: string): string | null {
  const goals = delegateTaskGoalsFromArgs(rawArgs);
  if (goals.length === 0) return "Delegando tarefas";
  if (goals.length === 1) return clip(`Delegando: ${goals[0]}`, 100);
  return `Delegando ${goals.length} tarefas`;
}

/** Corpo expandido amigável — evita JSON bruto dos args. */
export function formatDelegateTaskArgsBody(rawArgs: string): string {
  const goals = delegateTaskGoalsFromArgs(rawArgs);
  if (goals.length === 0) return "A executar subtarefas em paralelo…";
  if (goals.length === 1) return goals[0];
  return goals.map((goal, i) => `${i + 1}. ${goal}`).join("\n");
}

function formatTodo(data: JsonRecord): FriendlyToolResult {
  const summary =
    typeof data.summary === "object" && data.summary !== null
      ? (data.summary as JsonRecord)
      : null;
  if (!summary) {
    return { headline: "Lista de tarefas", detail: "" };
  }

  const total = typeof summary.total === "number" ? summary.total : 0;
  const pending = typeof summary.pending === "number" ? summary.pending : 0;
  const inProgress =
    typeof summary.in_progress === "number" ? summary.in_progress : 0;

  if (total === 0) {
    return { headline: "Nenhuma tarefa na lista", detail: "" };
  }

  // Headline curto — o ChatTodoPanel mostra o resumo detalhado.
  const headline =
    inProgress > 0
      ? "Tarefas em andamento"
      : pending > 0
        ? "Tarefas"
        : "Tarefas concluídas";

  const items = Array.isArray(data.todos) ? data.todos : [];
  const statusLabel: Record<string, string> = {
    pending: "pendente",
    in_progress: "em andamento",
    completed: "concluída",
    cancelled: "cancelada",
  };

  const detailLines: string[] = [];
  for (const item of items.slice(0, 20)) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as JsonRecord;
    const content = asString(row.content) || asString(row.text);
    if (!content) continue;
    const status = asString(row.status) || "pending";
    detailLines.push(`• [${statusLabel[status] ?? status}] ${content}`);
  }
  if (items.length > 20) {
    detailLines.push(`• … e mais ${items.length - 20}`);
  }

  return {
    headline,
    detail: detailLines.join("\n"),
  };
}

function parseProcessArgs(rawArgs?: string): JsonRecord | null {
  return parseJsonRecord(rawArgs);
}

function parseTerminalArgs(rawArgs?: string): JsonRecord | null {
  return parseJsonRecord(rawArgs);
}

const EXEC_CODE_FAILURE_STATUSES = new Set([
  "interrupted",
  "failed",
  "timeout",
  "error",
]);

/** Lê o `code` dos args do execute_code. */
function extractExecutedCode(rawArgs?: string): string {
  const data = parseJsonRecord(rawArgs);
  return asString(data?.code)?.trim() ?? "";
}

/** Descreve, em uma frase curta, O QUE o código faz — pro chip não mostrar só
 *  "Código executado" sem dizer qual. Tenta, em ordem: chamada HTTP
 *  (método + destino), caminho de arquivo mexido, e por fim a 1ª linha útil. */
function describeExecutedCode(rawArgs?: string): string | undefined {
  const code = extractExecutedCode(rawArgs);
  if (!code) return undefined;

  // 1) Chamada HTTP: requests.delete(...), httpx.post(...), session.get(...), .patch("url")
  const http = code.match(
    /\b(?:requests|httpx|session|client|http)\s*\.\s*(get|post|put|patch|delete|head)\s*\(\s*(?:f?['"]([^'"]+)['"])?/i,
  );
  if (http) {
    const method = http[1].toUpperCase();
    const url = http[2];
    if (url) {
      let tail = url.replace(/^https?:\/\/[^/]+/i, ""); // tira o host
      tail = tail.split("?")[0] || url;
      if (tail.length > 42) tail = `…${tail.slice(-40)}`;
      return `${method} ${tail}`;
    }
    return method;
  }

  // 2) Arquivo mexido
  const pathHint = extractScriptPathHint(rawArgs);
  if (pathHint) return pathHint;

  // 3) 1ª linha útil (pula imports, comentários e linhas em branco)
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^(import|from|print|#|\"\"\"|''')/.test(line)) continue;
    return line.length > 48 ? `${line.slice(0, 47)}…` : line;
  }
  return undefined;
}

function buildExecuteCodeSuccessHeadline(data: JsonRecord, rawArgs?: string): string {
  const parts = ["Código executado"];
  const what = describeExecutedCode(rawArgs);
  if (what) parts.push(what);
  const duration = data.duration_seconds;
  const toolCalls = data.tool_calls_made;
  if (typeof duration === "number") {
    parts.push(
      `${duration < 1 ? duration.toFixed(2) : duration.toFixed(1)}s`,
    );
  }
  if (typeof toolCalls === "number" && toolCalls > 0) {
    parts.push(
      `${toolCalls} chamada${toolCalls === 1 ? "" : "s"} de ferramenta`,
    );
  }
  return clip(parts.join(" · "));
}

function formatExecuteCode(data: JsonRecord, rawArgs?: string): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    const pathHint = extractScriptPathHint(rawArgs);
    const rawOut = (asString(data.output) ?? "").trim();
    return {
      headline: clip(humanizeKnownToolError(error)),
      detail: rawOut ? humanizeScriptStdout(rawOut, { pathHint }) : "",
    };
  }

  const status = asString(data.status)?.toLowerCase();
  const output = (asString(data.output) ?? "").trimEnd();
  const stderr = (asString(data.stderr) ?? "").trim();
  const combined =
    output && stderr
      ? `${output}\n--- stderr ---\n${stderr}`
      : output || stderr;

  const pathHint = extractScriptPathHint(rawArgs);
  const humanize = (text: string): string =>
    text.trim() ? humanizeScriptStdout(text, { pathHint }) : "";

  if (status === "interrupted") {
    return {
      headline: "Execução interrompida",
      detail: humanize(combined),
    };
  }

  if (status && EXEC_CODE_FAILURE_STATUSES.has(status)) {
    return {
      headline:
        status === "timeout" ? "Tempo esgotado" : "Erro ao executar código",
      detail: humanize(combined),
    };
  }

  return {
    headline: buildExecuteCodeSuccessHeadline(data, rawArgs),
    detail: humanize(combined),
  };
}

function formatBrowserSnapshot(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error || asBool(data.success) === false) {
    const msg = humanizeKnownToolError(error ?? "Falha ao capturar screenshot");
    const friendly = /chrome|chromium|browser.*not found|executable/i.test(msg)
      ? "Chrome não encontrado ou indisponível"
      : msg;
    return { headline: clip(friendly), detail: "" };
  }
  const url = asString(data.url);
  if (url) return { headline: clip(`Screenshot · ${url}`), detail: "" };
  return { headline: "Screenshot capturado", detail: "" };
}

function formatBrowserVision(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error || asBool(data.success) === false) {
    return {
      headline: clip(humanizeKnownToolError(error ?? "Falha na visão do browser")),
      detail: "",
    };
  }
  const summary = asString(data.summary) ?? asString(data.description);
  if (summary) return { headline: clip(summary), detail: "" };
  return { headline: "Análise visual concluída", detail: "" };
}

function formatBrowserNavigate(data: JsonRecord, rawArgs?: string): FriendlyToolResult {
  const error = asString(data.error);
  if (error || asBool(data.success) === false) {
    const msg = humanizeKnownToolError(error ?? "Navegação falhou");
    return { headline: clip(msg), detail: "" };
  }

  const args = parseJsonRecord(rawArgs);
  const url =
    asString(data.url) ??
    asString(args?.url) ??
    asString(data.final_url);
  if (url) return { headline: clip(`Navegou para ${url}`), detail: "" };
  return { headline: "Navegação concluída", detail: "" };
}

function formatTerminal(data: JsonRecord, rawArgs?: string): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    return { headline: clip(humanizeKnownToolError(error)), detail: "" };
  }

  const exitCode = data.exit_code;
  const output = asString(data.output) ?? "";
  const args = parseTerminalArgs(rawArgs);
  const description = asString(args?.description);
  const sessionId = asString(data.session_id) ?? "";
  const isBackgroundSpawn =
    sessionId.startsWith("proc_") &&
    output.includes("Background process started");

  if (isBackgroundSpawn) {
    const headline = description
      ? `${description} — executando em segundo plano…`
      : "Executando em segundo plano…";
    return { headline: clip(headline), detail: "" };
  }

  if (typeof exitCode === "number" && exitCode !== 0) {
    const headline = description
      ? `${description} — falhou (código ${exitCode})`
      : `Comando falhou (código ${exitCode})`;
    return {
      headline: clip(headline),
      detail: output.trim() ? output.trimEnd() : "",
    };
  }

  if (output.trim()) {
    if (isUnifiedDiffOutput(output)) {
      const file = primaryPathFromDiff(output);
      return {
        headline: file ? clip(shortenToolPath(file)) : clip("Alterações no arquivo"),
        detail: output.trimEnd(),
      };
    }
    const lines = output.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length === 1) {
      const line = lines[0]!;
      const humanized = humanizeScriptStdout(line);
      const headline = description
        ? clip(description)
        : clip(humanized || line);
      return { headline, detail: "" };
    }
    const headline = description
      ? clip(description)
      : `Saída com ${lines.length} linhas`;
    return {
      headline,
      detail: lines.length > 1 ? output.trimEnd() : "",
    };
  }

  if (description) {
    return { headline: clip(description), detail: "" };
  }

  if (typeof exitCode === "number" && exitCode === 0) {
    return { headline: "Comando concluído", detail: "" };
  }

  return { headline: "Comando executado", detail: "" };
}

function formatProcess(data: JsonRecord, rawArgs?: string): FriendlyToolResult {
  const status = asString(data.status)?.toLowerCase();
  const error = asString(data.error);
  if (error) {
    return { headline: clip(humanizeKnownToolError(error)), detail: "" };
  }

  const args = parseProcessArgs(rawArgs);
  const action = asString(args?.action)?.toLowerCase();

  if (status === "killed") {
    return { headline: "Processo encerrado", detail: "" };
  }
  if (status === "already_exited") {
    return {
      headline:
        action === "kill"
          ? "Processo já estava encerrado"
          : "O processo já foi encerrado",
      detail: "",
    };
  }
  if (status === "not_found") {
    return {
      headline: "Processo em segundo plano não encontrado",
      detail: "",
    };
  }
  if (status === "running") {
    return { headline: "Processo em execução", detail: "" };
  }
  if (status === "exited") {
    const code = data.exit_code;
    const codeText =
      typeof code === "number" ? ` (código ${code})` : "";
    const output = asString(data.output) ?? "";
    const buildMatch = output.match(/BUILD SUCCESSFUL[^\n]*/i);
    if (typeof code === "number" && code === 0 && buildMatch) {
      return {
        headline: "Build concluído com sucesso",
        detail: buildMatch[0].trim(),
      };
    }
    if (typeof code === "number" && code === 0 && action === "wait") {
      return { headline: "Processo concluído com sucesso", detail: "" };
    }
    if (typeof code === "number" && code !== 0) {
      return {
        headline: `Processo falhou (código ${code})`,
        detail: output.trimEnd(),
      };
    }
    return { headline: `Processo encerrado${codeText}`, detail: "" };
  }
  if (status === "ok") {
    const message = asString(data.message);
    if (message) return { headline: clip(message), detail: "" };
    return { headline: "Operação concluída", detail: "" };
  }

  return { headline: "", detail: "" };
}

/**
 * Nome de exibição a partir do slug da skill.
 *
 * O slug (nome do diretório/frontmatter) é kebab-case por contrato
 * (`git-commit-push`), mas mostrar isso cru ao usuário fica feio. Aqui vira um
 * nome legível em sentence-case (`Git commit push`), sem tocar no slug real
 * (que segue em `SkillViewDisplay.slug` para caminhos/edição).
 */
export function humanizeSkillName(raw: string): string {
  const slug = (raw || "").trim();
  if (!slug) return "";
  // Já parece um nome legível (tem espaço e uma maiúscula) — não mexer.
  if (/\s/.test(slug) && /[A-ZÀ-Þ]/.test(slug)) return slug;
  const words = slug
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return slug;
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export interface SkillViewDisplay {
  /** Nome legível para exibição (sentence-case, sem hífens). */
  name: string;
  /** Slug real (kebab-case) — diretório/frontmatter; usar para editar/abrir. */
  slug: string;
  description: string;
  file?: string;
  tags: string[];
  relatedSkills: string[];
  path?: string;
  linkedFiles: Record<string, string[]>;
  content?: string;
  setupNeeded: boolean;
  usageHint?: string;
}

function parseLinkedFiles(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  const record = value as JsonRecord;
  const linked: Record<string, string[]> = {};
  for (const [key, files] of Object.entries(record)) {
    const list = asStringArray(files);
    if (list.length > 0) linked[key] = list;
  }
  return linked;
}

function stripSkillFrontmatter(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) return trimmed;
  const end = trimmed.indexOf("\n---", 3);
  if (end < 0) return trimmed;
  return trimmed.slice(end + 4).trimStart();
}

export function parseSkillViewDisplay(
  rawResult: string | null | undefined,
): SkillViewDisplay | null {
  const data = parseJsonRecord(rawResult);
  if (!data) return null;
  return skillViewFromRecord(data);
}

function skillViewFromRecord(data: JsonRecord): SkillViewDisplay | null {
  if (asBool(data.success) !== true) return null;
  if (data.skipped === true && data.workspace_mismatch === true) return null;

  const name = asString(data.name);
  if (!name) return null;

  return {
    name: humanizeSkillName(name),
    slug: name,
    description: asString(data.description) ?? "",
    file: asString(data.file),
    tags: asStringArray(data.tags),
    relatedSkills: asStringArray(data.related_skills),
    path: asString(data.path),
    linkedFiles: parseLinkedFiles(data.linked_files),
    content: asString(data.content),
    setupNeeded: data.setup_needed === true,
    usageHint: asString(data.usage_hint),
  };
}

export function formatSkillViewSummary(display: SkillViewDisplay): string {
  const lines: string[] = [display.name];
  if (display.file) {
    lines[0] = `${display.name} · ${display.file}`;
  }
  if (display.description) {
    lines.push("", display.description);
  } else if (display.file && display.content) {
    const preview = stripSkillFrontmatter(display.content);
    if (preview) {
      const clipped =
        preview.length > 220 ? `${preview.slice(0, 217).trimEnd()}…` : preview;
      lines.push("", clipped);
    }
  }
  return lines.join("\n").trim();
}

function formatSkillLinkedFiles(linkedFiles: Record<string, string[]>): string[] {
  const lines: string[] = [];
  const labels: Record<string, string> = {
    references: "Referências",
    templates: "Templates",
    assets: "Assets",
    scripts: "Scripts",
    other: "Outros",
  };
  for (const [key, files] of Object.entries(linkedFiles)) {
    const label = labels[key] ?? key;
    lines.push(`${label}`);
    for (const file of files) {
      lines.push(`  · ${file}`);
    }
  }
  return lines;
}

export function formatSkillViewDetail(display: SkillViewDisplay): string {
  const sections: string[] = [];

  sections.push("Nome", display.name);
  if (display.file) {
    sections.push("", "Arquivo", display.file);
  }

  if (display.description) {
    sections.push("", "Descrição", display.description);
  }

  if (display.tags.length > 0) {
    sections.push("", "Tags", display.tags.join(", "));
  }

  if (display.relatedSkills.length > 0) {
    sections.push("", "Skills relacionadas", display.relatedSkills.join(", "));
  }

  if (display.path) {
    sections.push("", "Caminho", display.path);
  }

  const linkedLines = formatSkillLinkedFiles(display.linkedFiles);
  if (linkedLines.length > 0) {
    sections.push("", "Arquivos vinculados", ...linkedLines);
  }

  if (display.setupNeeded) {
    sections.push("", "Configuração", "Esta skill precisa de setup antes do uso.");
  }

  if (display.usageHint) {
    sections.push("", "Dica", display.usageHint);
  }

  if (display.content) {
    const body = stripSkillFrontmatter(display.content);
    if (body) {
      sections.push("", "Conteúdo", body);
    }
  }

  return sections.join("\n").trim();
}

export function formatSkillViewCollapsedPreview(
  rawResult: string | null | undefined,
): string | null {
  const display = parseSkillViewDisplay(rawResult);
  if (!display) return null;
  const summary = formatSkillViewSummary(display);
  return summary || null;
}

function formatSkillView(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    const hint = asString(data.hint);
    return {
      headline: clip(humanizeKnownToolError(error)),
      detail: hint ?? "",
    };
  }

  if (data.skipped === true && data.workspace_mismatch === true) {
    return {
      headline: clip(asString(data.message) || "Skill indisponível neste workspace"),
      detail: "",
    };
  }

  const display = skillViewFromRecord(data);
  if (!display) {
    return { headline: "Skill carregada", detail: "" };
  }

  return {
    headline: display.file ? `${display.name} · ${display.file}` : display.name,
    detail: formatSkillViewDetail(display),
  };
}

function formatSearchFiles(data: JsonRecord, rawArgs?: string): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    return { headline: clip(error), detail: "" };
  }

  const args = parseJsonRecord(rawArgs ?? "") ?? {};
  const pattern =
    asString(data.pattern) ?? asString(args.pattern) ?? "";
  const path =
    asString(data.path) ?? asString(args.path) ?? "";
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const total =
    typeof data.total_count === "number" ? data.total_count : matches.length;
  const truncated = data.truncated === true;

  let headline = pattern
    ? `Busca: ${clip(pattern, 60)}`
    : "Busca em arquivos";
  if (path) headline += ` em ${clip(shortenToolPath(path), 40)}`;
  if (total > 0) headline += ` — ${total} resultado${total === 1 ? "" : "s"}`;
  else headline += " — nenhum resultado";
  if (truncated) headline += " (truncado)";

  const detailLines = matches
    .slice(0, 20)
    .map((match) => {
      if (typeof match !== "object" || match === null) return "";
      const row = match as JsonRecord;
      const file = asString(row.path) ?? asString(row.file) ?? "";
      const line =
        typeof row.line === "number" ? `:${row.line}` : "";
      const content = asString(row.content) ?? asString(row.text) ?? "";
      if (file && content) return `${shortenToolPath(file)}${line}: ${content}`;
      if (file) return shortenToolPath(file);
      return content;
    })
    .filter(Boolean);

  return {
    headline: clip(headline),
    detail: detailLines.length > 0 ? detailLines.join("\n") : "",
  };
}

function formatWebSearch(data: JsonRecord, rawArgs?: string): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    return { headline: clip(error), detail: "" };
  }

  const args = parseJsonRecord(rawArgs ?? "") ?? {};
  const query = asString(args.query) ?? asString(data.query) ?? "";
  const results = Array.isArray(data.results) ? data.results : [];

  const headline = query
    ? `Busca web: ${clip(query, 72)}`
    : results.length > 0
      ? `${results.length} resultado${results.length === 1 ? "" : "s"}`
      : "Busca web";

  const detailLines = results
    .slice(0, 8)
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      const row = item as JsonRecord;
      const title = asString(row.title) ?? asString(row.url) ?? "";
      const url = asString(row.url);
      if (title && url && title !== url) return `${title}\n${url}`;
      return title || url || "";
    })
    .filter(Boolean);

  return {
    headline: clip(headline),
    detail: detailLines.join("\n\n"),
  };
}

function formatTextToSpeech(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    return { headline: clip(error), detail: "" };
  }
  const filePath = asString(data.file_path);
  if (asBool(data.success) === false) {
    return { headline: "Áudio não gerado", detail: "" };
  }
  if (filePath) {
    return {
      headline: "Áudio gerado",
      detail: shortenToolPath(filePath),
    };
  }
  return { headline: "Áudio gerado", detail: "" };
}

function formatGenericJson(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    return { headline: clip(humanizeKnownToolError(error)), detail: "" };
  }

  const status = asString(data.status)?.toLowerCase();
  if (status === "not_found") {
    return {
      headline: "Processo em segundo plano não encontrado",
      detail: "",
    };
  }

  const message = asString(data.message) || asString(data.summary);
  if (message) return { headline: clip(message), detail: "" };

  const output = asString(data.output);
  if (output?.trim()) {
    if (isUnifiedDiffOutput(output)) {
      const file = primaryPathFromDiff(output);
      return {
        headline: file ? clip(shortenToolPath(file)) : clip("Alterações no arquivo"),
        detail: output.trimEnd(),
      };
    }
    const humanized = humanizeScriptStdout(output.trimEnd());
    if (humanized) {
      const lines = humanized.split(/\r?\n/).filter(Boolean);
      return {
        headline:
          lines.length === 1 ? clip(lines[0]!) : clip("Resultado da operação"),
        detail: lines.length > 1 ? humanized : "",
      };
    }
  }

  const success = asBool(data.success);
  if (success === true) return { headline: "", detail: "" };
  if (success === false) return { headline: "Operação falhou", detail: "" };

  return { headline: "", detail: "" };
}

function stripMarkdownBold(text: string): string {
  return text.replace(/\*\*/g, "").trim();
}

const DELEGATE_FAILURE_STATUSES = new Set([
  "failed",
  "error",
  "interrupted",
  "timeout",
]);

function isDelegateSubagentFailure(status: string): boolean {
  return DELEGATE_FAILURE_STATUSES.has(status.toLowerCase());
}

function formatDelegateTask(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error) return { headline: clip(error), detail: "" };

  if (asBool(data.success) === false) {
    return { headline: "Delegação falhou", detail: "" };
  }

  const results = Array.isArray(data.results)
    ? (data.results as JsonRecord[])
    : [];
  if (!results.length) {
    return { headline: "Delegação sem resultados", detail: "" };
  }

  const completed = results.filter(
    (row) => asString(row.status)?.toLowerCase() === "completed",
  );
  const failed = results.filter((row) => {
    const status = asString(row.status)?.toLowerCase() ?? "";
    return isDelegateSubagentFailure(status);
  });

  const headline =
    failed.length === results.length
      ? `Delegação falhou (0/${results.length})`
      : failed.length > 0
        ? `${completed.length}/${results.length} subagentes concluídos`
        : `${results.length} subagente${results.length === 1 ? "" : "s"} concluído${results.length === 1 ? "" : "s"}`;

  const detailLines: string[] = [];
  for (const [index, row] of results.slice(0, 12).entries()) {
    const status = asString(row.status)?.toLowerCase() ?? "completed";
    const summary =
      stripMarkdownBold(asString(row.summary) ?? "") ||
      `Tarefa ${typeof row.task_index === "number" ? row.task_index + 1 : index + 1}`;
    const mark = status === "completed" ? "✓" : "✗";
    detailLines.push(`${mark} ${clip(summary, 120)}`);
  }
  if (results.length > 12) {
    detailLines.push(`… e mais ${results.length - 12}`);
  }

  return { headline: clip(headline), detail: detailLines.join("\n") };
}


function formatWiser(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    return { headline: clip(error), detail: "" };
  }

  const question = asString(data.question) || "Pergunta ao usuário";
  const choices =
    asStringArray(data.choices_offered).length > 0
      ? asStringArray(data.choices_offered)
      : asStringArray(data.choices);
  const userResponse = humanizeWiserUserResponse(
    asString(data.user_response) ?? "",
  );

  let headline = `Resposta: ${clip(userResponse, 100)}`;
  if (userResponse === "Sem resposta a tempo") {
    headline = "Sem resposta a tempo";
  } else if (userResponse === "Cancelado pelo usuário") {
    headline = "Cancelado pelo usuário";
  }

  const detailLines: string[] = [question];
  if (choices.length > 0) {
    detailLines.push("");
    detailLines.push("Opções oferecidas:");
    for (const [index, choice] of choices.entries()) {
      detailLines.push(`${index + 1}. ${choice}`);
    }
  }
  const context = asString(data.context);
  if (context) {
    detailLines.push("");
    detailLines.push(context);
  }

  return {
    headline: clip(headline),
    detail: detailLines.join("\n"),
  };
}

/** Remove prefixos ``LINE_NUM|`` do resultado de ``read_file``. */
export function stripReadFileLineNumbers(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\|/, ""))
    .join("\n");
}

function formatReadFile(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    return { headline: clip(humanizeKnownToolError(error)), detail: "" };
  }

  const status = asString(data.status)?.toLowerCase();
  if (status === "unchanged" || data.dedup === true) {
    return {
      headline: clip(asString(data.message) || "Arquivo sem alterações"),
      detail: "",
    };
  }

  if (asBool(data.is_binary) === true) {
    return {
      headline: clip(
        asString(data.hint) ||
          asString(data.message) ||
          "Arquivo binário — não é possível exibir como texto",
      ),
      detail: "",
    };
  }

  if (asBool(data.content_returned) === false) {
    return {
      headline: clip(asString(data.message) || "Conteúdo omitido"),
      detail: "",
    };
  }

  const rawContent = typeof data.content === "string" ? data.content : "";
  const content = stripReadFileLineNumbers(rawContent);
  if (!content.trim()) {
    return { headline: "Arquivo vazio", detail: "" };
  }

  // Headline vazio: o card usa o path dos args como título.
  return {
    headline: "",
    detail: content,
  };
}

export const LINT_SECTION_MARKER = "\n\n── Lint ──\n";

function formatLintSection(lint: unknown): string {
  if (!lint || typeof lint !== "object") return "";
  const row = lint as JsonRecord;
  const output = asString(row.output);
  const status = asString(row.status)?.toLowerCase();
  if (!output && status !== "error") return "";
  const body = output || "Problemas de lint detectados";
  return `${LINT_SECTION_MARKER}${body}`;
}

function asPathList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function formatWriteFile(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    return { headline: clip(humanizeKnownToolError(error)), detail: "" };
  }

  // Avisos de file_state não viram título — o card usa o path dos args.
  return {
    headline: "",
    detail: "",
  };
}

function formatPatch(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    return { headline: clip(humanizeKnownToolError(error)), detail: "" };
  }

  if (asBool(data.success) === false) {
    return { headline: "Falha ao aplicar patch", detail: "" };
  }

  const diff =
    asString(data.diff) ??
    (() => {
      const output = asString(data.output);
      return output && isUnifiedDiffOutput(output) ? output : "";
    })() ??
    "";
  const lintSection = formatLintSection(data.lint);

  if (!diff.trim() && !lintSection) {
    const modified = asPathList(data.files_modified);
    const created = asPathList(data.files_created);
    const deleted = asPathList(data.files_deleted);
    const count = modified.length + created.length + deleted.length;
    return {
      headline:
        count > 0
          ? `${count} arquivo${count === 1 ? "" : "s"} atualizado${count === 1 ? "" : "s"}`
          : "Patch aplicado",
      detail: "",
    };
  }

  const detail = `${diff.trimEnd()}${lintSection}`;
  // Headline vazio quando há diff: o card usa o path dos args.
  return {
    headline: "",
    detail,
  };
}

function formatPlainToolFailure(
  toolName: string,
  raw: string,
): FriendlyToolResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const key = toolName.trim().toLowerCase();
  const isBrowser =
    key.startsWith("browser_") ||
    key === "playwright" ||
    key.includes("navigate") ||
    key.includes("snapshot");
  const isCode =
    key === "execute_code" ||
    key === "run_python" ||
    key === "python" ||
    key === "terminal" ||
    key === "shell";

  if (/^traceback \(most recent call last\)/i.test(trimmed)) {
    const errorLine =
      [...trimmed.split(/\r?\n/)]
        .reverse()
        .find((line) => /Error:|Exception:/i.test(line)) ?? "";
    const headline = errorLine
      ? clip(stripMarkdownBold(errorLine))
      : isCode
        ? "Erro ao executar código"
        : "Erro na ferramenta";
    return {
      headline,
      detail: trimmed.length > 600 ? `${trimmed.slice(0, 597)}…` : trimmed,
    };
  }

  if (
    isBrowser &&
    /navigation failed|net::err_|timeout|blocked|could not navigate/i.test(trimmed)
  ) {
    const first = trimmed.split(/\r?\n/)[0]?.trim() || trimmed;
    return { headline: clip(first), detail: "" };
  }

  if (/^error[:\s]/i.test(trimmed) || /\bnet::err_/i.test(trimmed)) {
    const first = trimmed.split(/\r?\n/)[0]?.trim() || trimmed;
    return { headline: clip(first), detail: "" };
  }

  return null;
}

function fmtCentsBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Valor de um lançamento, seja `amount` (string já formatada, do brief) ou
 *  `amount_cents` (número cru, do registro limpo). */
function financeAmount(tx: JsonRecord): string | undefined {
  const formatted = asString(tx.amount);
  if (formatted) return formatted;
  return typeof tx.amount_cents === "number"
    ? fmtCentsBRL(tx.amount_cents)
    : undefined;
}

/** Uma linha legível de um lançamento: data · tipo · valor · categoria · situação. */
function financeTxLine(tx: JsonRecord): string {
  const parts: string[] = [];
  const date = asString(tx.date);
  if (date) {
    const [y, m, d] = date.split("-");
    if (y && m && d) parts.push(`${d}/${m}/${y}`);
  }
  const type = asString(tx.type);
  if (type) parts.push(type === "receita" ? "receita" : "despesa");
  const amount = financeAmount(tx);
  if (amount) parts.push(amount);
  const cat = asString(tx.category);
  if (cat) parts.push(cat);
  const status = asString(tx.status);
  if (status) parts.push(status);
  return parts.join(" · ");
}

/** Título de um lançamento: descrição · valor · situação. */
function financeTxHeadline(tx: JsonRecord | null): string {
  const desc = tx
    ? asString(tx.description) || asString(tx.category) || "Lançamento"
    : "Lançamento";
  const bits = [desc];
  const amount = tx ? financeAmount(tx) : undefined;
  if (amount) bits.push(amount);
  const status = tx ? asString(tx.status) : undefined;
  if (status) bits.push(status);
  return clip(bits.join(" · "), 120);
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object"
    ? (value as JsonRecord)
    : null;
}

/** finance_update_transaction: título = lançamento; detalhe = o que mudou
 *  (antes → depois, do campo `resumo`) em vez do cru `ok: true`. */
function formatFinanceUpdate(data: JsonRecord): FriendlyToolResult {
  const tx = asRecord(data.transaction);
  const resumo = asString(data.resumo);
  return {
    headline: financeTxHeadline(tx),
    detail: resumo ?? (tx ? financeTxLine(tx) : ""),
  };
}

/** finance_add_transaction: título = lançamento; detalhe = a linha do lançamento
 *  + impacto no saldo e alertas (saldo/conta negativos, colisão de pagamentos). */
function formatFinanceAdd(data: JsonRecord): FriendlyToolResult {
  const tx = asRecord(data.transaction);
  const lines: string[] = [];
  if (tx) {
    const line = financeTxLine(tx);
    if (line) lines.push(line);
  }
  const saldo = asString(data.saldo_total_apos);
  if (saldo) lines.push(`Saldo total: ${saldo}`);
  const contaSaldo = asString(data.conta_saldo_apos);
  if (contaSaldo) lines.push(`Saldo da conta: ${contaSaldo}`);
  for (const key of ["alerta_saldo", "alerta_conta", "alerta_pagamentos"]) {
    const alert = asString(data[key]);
    if (alert) lines.push(`⚠️ ${alert}`);
  }
  return { headline: financeTxHeadline(tx), detail: lines.join("\n") };
}

/** finance_delete_transaction: mostra o que saiu (do `removed_transaction`). */
function formatFinanceDelete(data: JsonRecord): FriendlyToolResult {
  const removed = typeof data.removed === "number" ? data.removed : undefined;
  if (removed === 0) {
    return { headline: "Nada removido", detail: "" };
  }
  const tx = asRecord(data.removed_transaction);
  const desc = tx
    ? asString(tx.description) || asString(tx.category) || "Lançamento"
    : "Lançamento";
  const amount = tx ? financeAmount(tx) : undefined;
  const bits = [`Removido: ${desc}`];
  if (amount) bits.push(amount);
  return {
    headline: clip(bits.join(" · "), 120),
    detail: tx ? financeTxLine(tx) : "",
  };
}

/** finance_delete_transactions (massa): prévia de confirmação, ou contagem. */
function formatFinanceDeleteMany(data: JsonRecord): FriendlyToolResult {
  if (data.needs_confirmation === true) {
    const n =
      typeof data.would_remove === "number" ? data.would_remove : undefined;
    const sample = Array.isArray(data.sample) ? data.sample : [];
    const detail = sample
      .map((item) => {
        const t = asRecord(item);
        return t ? financeTxLine(t) || (asString(t.description) ?? "") : "";
      })
      .filter(Boolean)
      .join("\n");
    return {
      headline:
        n != null
          ? `Confirmar: apagar ${n} lançamentos`
          : "Confirmar exclusão em massa",
      detail,
    };
  }
  const removed = typeof data.removed === "number" ? data.removed : undefined;
  if (removed === 0) {
    return { headline: asString(data.message) ?? "Nada removido", detail: "" };
  }
  return {
    headline:
      removed != null
        ? `${removed} ${removed === 1 ? "lançamento removido" : "lançamentos removidos"}`
        : "Lançamentos removidos",
    detail: "",
  };
}

/** finance_transfer: título = valor · origem → destino; detalhe = a data. */
function formatFinanceTransfer(data: JsonRecord): FriendlyToolResult {
  const t = asRecord(data.transfer);
  if (!t) return { headline: "Transferência", detail: "" };
  const valor = asString(t.valor);
  const de = asString(t.de);
  const para = asString(t.para);
  const bits: string[] = [];
  if (valor) bits.push(valor);
  if (de && para) bits.push(`${de} → ${para}`);
  let detail = "";
  const date = asString(t.data);
  if (date) {
    const [y, m, d] = date.split("-");
    if (y && m && d) detail = `${d}/${m}/${y}`;
  }
  return { headline: clip(bits.join(" · "), 120) || "Transferência", detail };
}

const FRIENDLY_FORMATTERS: Record<
  string,
  (data: JsonRecord, rawArgs?: string) => FriendlyToolResult
> = {
  finance_update_transaction: (data) => formatFinanceUpdate(data),
  finance_add_transaction: (data) => formatFinanceAdd(data),
  finance_delete_transaction: (data) => formatFinanceDelete(data),
  finance_delete_transactions: (data) => formatFinanceDeleteMany(data),
  finance_transfer: (data) => formatFinanceTransfer(data),
  gateway_inspect: (data) => formatGatewayInspect(data),
  send_message: (data) => formatSendMessage(data),
  todo: (data) => formatTodo(data),
  delegate_task: (data) => formatDelegateTask(data),
  process: (data, rawArgs) => formatProcess(data, rawArgs),
  terminal: (data, rawArgs) => formatTerminal(data, rawArgs),
  shell: (data, rawArgs) => formatTerminal(data, rawArgs),
  wiser: (data) => formatWiser(data),
  ask_user: (data) => formatWiser(data),
  clarify: (data) => formatWiser(data),
  read_file: (data) => formatReadFile(data),
  write_file: (data) => formatWriteFile(data),
  patch: (data) => formatPatch(data),
  skill_view: (data) => formatSkillView(data),
  execute_code: (data, rawArgs) => formatExecuteCode(data, rawArgs),
  run_python: (data, rawArgs) => formatExecuteCode(data, rawArgs),
  python: (data, rawArgs) => formatExecuteCode(data, rawArgs),
  browser_snapshot: (data) => formatBrowserSnapshot(data),
  browser_vision: (data) => formatBrowserVision(data),
  browser_navigate: (data, rawArgs) => formatBrowserNavigate(data, rawArgs),
  search_files: (data, rawArgs) => formatSearchFiles(data, rawArgs),
  web_search: (data, rawArgs) => formatWebSearch(data, rawArgs),
  text_to_speech: (data) => formatTextToSpeech(data),
  memory: (data) => formatMemoryResult(data),
};

/** Infere status do card a partir do resultado bruto da ferramenta. */
export function inferToolResultStatus(
  toolName: string,
  rawResult: string | null | undefined,
): "complete" | "error" {
  return inferOutcomeStatus(toolName, rawResult);
}

const SUCCESS_HEADLINE_RE = /\bconcluíd[ao]s?\b/i;

/** Evita título de sucesso quando o card está em estado de erro. */
export function alignToolTitleWithStatus(
  title: string,
  status: "running" | "complete" | "error",
): string {
  const trimmed = title.trim();
  if (status !== "error" || !SUCCESS_HEADLINE_RE.test(trimmed)) return title;
  if (/^delegação concluída$/i.test(trimmed)) return "Delegação falhou";
  return trimmed.replace(/\bconcluíd([ao]s?)\b/gi, "falhou");
}

/** Status persistido a partir do resultado bruto (ignora running). */
export function resolveToolResultStatus(
  toolName: string,
  rawResult: string | null | undefined,
  storedStatus?: "running" | "complete" | "error",
): "complete" | "error" {
  const raw = (rawResult ?? "").trim();
  if (!raw) {
    return storedStatus === "error" ? "error" : "complete";
  }
  return inferToolResultStatus(toolName, raw);
}

/** Resultado amigável completo (headline + detalhe opcional). */
export function formatFriendlyToolResult(
  toolName: string,
  rawResult: string | null | undefined,
  rawArgs?: string | null,
): FriendlyToolResult | null {
  const raw = (rawResult ?? "").trim();
  if (!raw) return null;

  const plainFailure = formatPlainToolFailure(toolName, raw);
  if (plainFailure) return plainFailure;

  const data = parseJsonRecord(raw);
  if (!data) return null;

  const key = toolName.trim().toLowerCase();
  const formatter = FRIENDLY_FORMATTERS[key];
  if (formatter) {
    return formatter(data, rawArgs ?? undefined);
  }

  const generic = formatGenericJson(data);
  return generic.headline || generic.detail.trim() ? generic : null;
}

/** Subtítulo amigável derivado do JSON de resultado da ferramenta. */
export function formatToolResultSubtitle(
  toolName: string,
  rawResult: string | null | undefined,
  rawArgs?: string | null,
): string | null {
  return formatFriendlyToolResult(toolName, rawResult, rawArgs)?.headline ?? null;
}

/** Corpo expandido amigável; null = usar formatação JSON padrão. */
export function formatToolResultBody(
  toolName: string,
  rawResult: string | null | undefined,
  rawArgs?: string | null,
): string | null {
  const friendly = formatFriendlyToolResult(toolName, rawResult, rawArgs);
  if (!friendly) return null;
  if (friendly.detail.trim()) return friendly.detail.trim();
  if (friendly.headline) return null;
  return null;
}

function formatSessionSearchArgsHeadline(rawArgs: string): string | null {
  const data = parseJsonRecord(rawArgs);
  const query =
    asString(data?.query)?.trim() ||
    asString(data?.session_search)?.trim() ||
    "";
  if (!query) return "Buscando na sessão";
  return clip(`Na sessão: "${clip(query, 52)}"`, 120);
}

function formatMemoryArgsHeadline(rawArgs: string): string | null {
  const data = parseJsonRecord(rawArgs);
  const action = asString(data?.action)?.trim().toLowerCase() ?? "";
  const content = asString(data?.content)?.trim() ?? "";
  const oldText = asString(data?.old_text)?.trim() ?? "";
  const query = asString(data?.query)?.trim() ?? "";
  const tag = asString(data?.tag)?.trim().replace(/^#/, "") ?? "";
  if (action === "recall" || (!action && (query || tag))) {
    if (tag) return clip(`Buscando na memória: #${tag}`, 120);
    if (query) return clip(`Buscando na memória: "${clip(query, 48)}"`, 120);
    return "Buscando na memória";
  }
  if (action === "describe_tag")
    return tag ? clip(`Descrevendo tag #${tag}`, 120) : "Descrevendo tag";
  if (action === "read") return "Lendo memória";
  if (action === "remove")
    return oldText
      ? clip(`Removendo da memória: "${clip(oldText, 48)}"`, 120)
      : "Removendo da memória";
  if (action === "replace")
    return content
      ? clip(`Atualizando memória: "${clip(content, 48)}"`, 120)
      : "Atualizando memória";
  if (action === "add" || content)
    return content
      ? clip(`Gravando memória: "${clip(content, 48)}"`, 120)
      : "Gravando memória";
  return "Consultando memória";
}

function formatMemoryResult(data: JsonRecord): FriendlyToolResult {
  const error = asString(data.error);
  if (error) {
    return { headline: "Falha ao consultar a memória", detail: error };
  }
  const rawEntries = Array.isArray(data.entries) ? data.entries : [];
  if (data.scoped_out != null && rawEntries.length === 0) {
    const blocked = Array.isArray(data.scoped_out)
      ? data.scoped_out
          .filter((item): item is string => typeof item === "string")
          .join(", ")
      : "";
    return {
      headline: "Memória fora do escopo desta pasta",
      detail: asString(data.hint) || (blocked ? `Escopo: ${blocked}` : ""),
    };
  }
  const count =
    typeof data.count === "number" && Number.isFinite(data.count)
      ? data.count
      : rawEntries.length;
  const tag = asString(data.tag)?.replace(/^#/, "");
  const query = asString(data.query);
  if (rawEntries.length === 0 && (query || tag || asString(data.hint))) {
    return {
      headline: tag ? `Nada em #${tag}` : "Nenhuma memória encontrada",
      detail: asString(data.hint) ?? "",
    };
  }
  if (rawEntries.length > 0) {
    const linhas = rawEntries.slice(0, 8).flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const rec = item as JsonRecord;
      const title = asString(rec.title);
      const preview = asString(rec.preview) || asString(rec.content);
      const line = title || (preview ? clip(preview, 72) : "");
      return line ? [line] : [];
    });
    const headline = tag
      ? `${count} em #${tag}`
      : count === 1
        ? "1 memória encontrada"
        : `${count} memórias encontradas`;
    const related = asStringArray(data.related_tags);
    const extra =
      related.length > 0 ? `Tags relacionadas: ${related.map((t) => `#${t}`).join(" ")}` : "";
    return {
      headline,
      detail: [linhas.map((l, i) => `${i + 1}. ${l}`).join("\n"), extra]
        .filter(Boolean)
        .join("\n"),
    };
  }
  const message = asString(data.message);
  if (message) return { headline: clip(message, 120), detail: "" };
  return { headline: "Memória atualizada", detail: "" };
}

function formatSearchFilesArgsHeadline(rawArgs: string): string | null {
  const data = parseJsonRecord(rawArgs);
  if (!data) return "Buscando arquivos";
  const pattern = asString(data.pattern)?.trim() ?? "";
  const path = asString(data.path)?.trim() ?? "";
  if (!pattern && !path) return "Buscando arquivos";
  let headline = pattern ? `Busca: ${clip(pattern, 60)}` : "Buscando arquivos";
  if (path) headline += ` · ${clip(shortenToolPath(path), 40)}`;
  return clip(headline, 120);
}

function formatPathArgsHeadline(
  rawArgs: string,
  emptyLabel: string,
): string | null {
  const data = parseJsonRecord(rawArgs);
  const path = asString(data?.path)?.trim() ?? "";
  if (!path) return emptyLabel;
  const short = shortenToolPath(path);
  if (short.length <= 72) return short;
  const base = short.replace(/\\/g, "/").split("/").filter(Boolean).at(-1);
  return base ? clip(base, 72) : clip(short, 72);
}

/** Chaves com payloads grandes — nunca dumps no painel do chat. */
const BULKY_TOOL_VALUE_KEYS = new Set([
  "old_string",
  "new_string",
  "content",
  "contents",
  "code",
  "source",
  "body",
  "text",
  "prompt",
  "diff",
  "output",
  "html",
  "data",
  "image_base64",
  "content_base64",
  "messages",
  "input",
  "file_content",
  "replacement",
  "patch",
  "context",
]);

/**
 * Resume args/resultado JSON omitindo valores volumosos.
 * Substitui o `JSON.stringify` no painel expandido.
 */
export function summarizeToolArgsForDisplay(
  rawArgs: string | null | undefined,
): string {
  const data = parseJsonRecord(rawArgs);
  if (!data) {
    const t = (rawArgs ?? "").trim();
    if (!t) return "";
    if (t.length > 400 || (t.startsWith("{") && t.includes("old_string"))) {
      return "";
    }
    return t;
  }

  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (BULKY_TOOL_VALUE_KEYS.has(key)) continue;
    if (typeof value === "string") {
      const v = value.trim();
      if (!v || v.length > 200 || v.includes("\n")) continue;
      lines.push(`${key}: ${clip(v, 120)}`);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
      continue;
    }
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === "string")
    ) {
      const joined = value
        .map((item) => item.trim())
        .filter(Boolean)
        .join(", ");
      if (joined && joined.length <= 160) {
        lines.push(`${key}: ${joined}`);
      }
    }
  }
  return lines.join("\n");
}

/** Headline amigável a partir dos args (ex.: send_message em andamento). */
export function formatToolArgsHeadline(
  toolName: string,
  rawArgs: string | null | undefined,
): string | null {
  const key = toolName.trim().toLowerCase();
  if (key === "send_message") {
    return formatSendMessageArgsHeadline(rawArgs ?? "");
  }
  if (key === "delegate_task") {
    return formatDelegateTaskArgsHeadline(rawArgs ?? "");
  }
  if (key === "search_files") {
    return formatSearchFilesArgsHeadline(rawArgs ?? "");
  }
  if (key === "session_search") {
    return formatSessionSearchArgsHeadline(rawArgs ?? "");
  }
  if (key === "memory") {
    return formatMemoryArgsHeadline(rawArgs ?? "");
  }
  if (key === "read_file") {
    return formatPathArgsHeadline(rawArgs ?? "", "Lendo arquivo");
  }
  if (key === "patch") {
    return formatPathArgsHeadline(rawArgs ?? "", "Aplicando patch");
  }
  if (key === "write_file") {
    return formatPathArgsHeadline(rawArgs ?? "", "Escrevendo arquivo");
  }
  return null;
}

/** Corpo expandido a partir dos args (quando ainda não há resultado). */
export function formatToolArgsBody(
  toolName: string,
  rawArgs: string | null | undefined,
): string | null {
  const key = toolName.trim().toLowerCase();
  if (key === "delegate_task") {
    return formatDelegateTaskArgsBody(rawArgs ?? "");
  }
  // Em andamento: título basta — sem dump de args no painel.
  if (
    key === "search_files" ||
    key === "session_search" ||
    key === "memory" ||
    key === "read_file" ||
    key === "patch" ||
    key === "write_file" ||
    key === "web_search" ||
    key === "web_extract"
  ) {
    return "";
  }
  return null;
}

/** True quando o JSON bruto seria só `{}` ou equivalente sem valor para o usuário. */
export function isEmptyToolArgs(rawArgs: string | null | undefined): boolean {
  const data = parseJsonRecord(rawArgs);
  if (!data) return !(rawArgs ?? "").trim();
  return Object.keys(data).length === 0;
}
