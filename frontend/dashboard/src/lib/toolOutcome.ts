import { isUnifiedDiffOutput } from "@/lib/toolActionTitle";
import { parseLeadingJsonObject } from "@/lib/parseLeadingJson";

export type ToolOutcome = "completed" | "failed" | "cancelled" | "pending";

export interface ToolOutcomeInput {
  name: string;
  status?: "running" | "complete" | "error";
  result?: string | null;
  args?: string;
}

const CANCELLED_PREFIX = /^\[Tool execution cancelled/i;

const TOOL_ERROR_HINT =
  /\b(traceback \(most recent|navigation failed|net::err_|could not navigate|operation failed|permission denied|access denied)\b/i;

const SHELL_TOOLS = new Set(["terminal", "shell"]);
const EXIT_CODE_TOOLS = new Set(["terminal", "shell", "process"]);

const EXEC_CODE_FAILURE_STATUSES = new Set([
  "interrupted",
  "failed",
  "timeout",
  "error",
]);

const DELEGATE_FAILURE_STATUSES = new Set([
  "failed",
  "error",
  "interrupted",
  "timeout",
]);

export const OPTIONAL_FAILURE_TOOLS = new Set([
  "browser_snapshot",
  "browser_vision",
]);

const COMMAND_INTERRUPTED_MARKER = "[Command interrupted]";

const LEGACY_PROCESS_ERROR_RE =
  /^No process with ID (proc_[\w]+)$/i;
const LEGACY_PROCESS_ALREADY_EXITED_RE =
  /^Process has already finished$/i;
const LEGACY_PROCESS_STDIN_UNAVAILABLE_RE =
  /^Process stdin not available/i;

/** Avisos técnicos do file_state (inglês) — não devem virar título do card. */
const FILE_STATE_PARTIAL_READ_RE =
  /\bwas last read with offset\/limit pagination\b/i;
const FILE_STATE_EXTERNAL_EDIT_RE =
  /\bwas modified since you last read it\b/i;
const FILE_STATE_SIBLING_EDIT_RE =
  /\bwas modified by sibling subagent\b/i;
const FILE_STATE_NEVER_READ_RE =
  /\bwas not read by this agent\b/i;

/** True para mensagens internas de staleness/paginação do file_state. */
export function isFileStateGuardMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return (
    FILE_STATE_PARTIAL_READ_RE.test(trimmed) ||
    FILE_STATE_EXTERNAL_EDIT_RE.test(trimmed) ||
    FILE_STATE_SIBLING_EDIT_RE.test(trimmed) ||
    FILE_STATE_NEVER_READ_RE.test(trimmed)
  );
}

/** Normaliza mensagens legadas em inglês (sessões antigas / cache). */
export function humanizeKnownToolError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;

  const notFound = trimmed.match(LEGACY_PROCESS_ERROR_RE);
  if (notFound) {
    const sid = notFound[1] ?? "?";
    return `Processo em segundo plano não encontrado (${sid}). Pode já ter encerrado ou o registro expirou.`;
  }
  if (LEGACY_PROCESS_ALREADY_EXITED_RE.test(trimmed)) {
    return "O processo já foi encerrado";
  }
  if (LEGACY_PROCESS_STDIN_UNAVAILABLE_RE.test(trimmed)) {
    return "Entrada do processo indisponível (backend remoto ou stdin fechado)";
  }
  if (
    trimmed.startsWith(
      "Recovered process cannot be killed after restart because",
    )
  ) {
    return "Não foi possível encerrar: o processo foi recuperado após reinício e o handle original não está mais disponível";
  }

  if (FILE_STATE_PARTIAL_READ_RE.test(trimmed)) {
    return "Leitura parcial — releia o arquivo completo antes de sobrescrever";
  }
  if (FILE_STATE_EXTERNAL_EDIT_RE.test(trimmed)) {
    return "Arquivo alterado desde a última leitura — releia antes de escrever";
  }
  if (FILE_STATE_SIBLING_EDIT_RE.test(trimmed)) {
    return "Alterado por outro subagente — releia antes de escrever";
  }
  if (FILE_STATE_NEVER_READ_RE.test(trimmed)) {
    return "Arquivo ainda não foi lido — leia antes de escrever";
  }

  // Guardrails anti-delírio falam com o MODELO ("reemita", "não invente").
  // No card do chat isso vaza para o usuário.
  if (
    /^Argumentos inválidos para `/i.test(trimmed) ||
    /Reemita a chamada/i.test(trimmed)
  ) {
    return /falta /i.test(trimmed)
      ? "Faltou um dado obrigatório"
      : "Os dados da ação estavam inválidos";
  }
  if (
    /não eram JSON válido/i.test(trimmed) ||
    /precisam ser um objeto JSON/i.test(trimmed)
  ) {
    return "A ação veio incompleta";
  }
  const modeBlock = trimmed.match(
    /não está disponível no modo\s+(\w+)/i,
  );
  if (modeBlock) {
    const rawMode = (modeBlock[1] ?? "").toLowerCase();
    const mode = rawMode === "code" ? "Code" : "Chat";
    return `Essa ação não está disponível no modo ${mode}`;
  }

  return trimmed;
}

type JsonRecord = Record<string, unknown>;

function parseJsonRecord(raw: string | null | undefined): JsonRecord | null {
  return parseLeadingJsonObject(raw);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function shellExitCodeFailed(toolName: string, data: JsonRecord): boolean {
  const key = toolName.trim().toLowerCase();
  const exitCode = data.exit_code;
  return (
    SHELL_TOOLS.has(key) &&
    typeof exitCode === "number" &&
    exitCode !== 0
  );
}

function processExitFailed(toolName: string, data: JsonRecord): boolean {
  const key = toolName.trim().toLowerCase();
  if (key !== "process") return false;
  const status = asString(data.status)?.toLowerCase();
  const exitCode = data.exit_code;
  return status === "exited" && typeof exitCode === "number" && exitCode !== 0;
}

/** Resultado bruto indica cancelamento explícito (não é falha estrutural). */
export function isToolCancelled(rawResult: string | null | undefined): boolean {
  const raw = (rawResult ?? "").trim();
  return Boolean(raw && CANCELLED_PREFIX.test(raw));
}

function isDelegateSubagentFailure(status: string): boolean {
  return DELEGATE_FAILURE_STATUSES.has(status.toLowerCase());
}

function toolOutputText(data: JsonRecord): string {
  const parts: string[] = [];
  const output = asString(data.output);
  if (output) parts.push(output);
  const stderr = asString(data.stderr);
  if (stderr) parts.push(stderr);
  return parts.join("\n");
}

/** Infere falha estrutural a partir do resultado bruto (ignora `tc.status`). */
export function inferToolFailed(
  toolName: string,
  rawResult: string | null | undefined,
): boolean {
  const raw = (rawResult ?? "").trim();
  if (!raw) return false;

  const data = parseJsonRecord(raw);
  if (data) {
    if (
      toolName.trim().toLowerCase() === "skill_view" &&
      data.skipped === true &&
      data.workspace_mismatch === true
    ) {
      return false;
    }
    if (asBool(data.success) === false) return true;
    if (asString(data.error)) return true;

    const status = asString(data.status)?.toLowerCase();
    if (status === "not_found" || status === "error") return true;

    const key = toolName.trim().toLowerCase();
    if (key === "execute_code" && status && EXEC_CODE_FAILURE_STATUSES.has(status)) {
      return true;
    }

    if (shellExitCodeFailed(toolName, data)) return true;
    if (processExitFailed(toolName, data)) return true;

    if (key === "delegate_task" && Array.isArray(data.results)) {
      const rows = data.results as JsonRecord[];
      const failed = rows.some((row) =>
        isDelegateSubagentFailure(asString(row.status) ?? ""),
      );
      const completed = rows.some(
        (row) => asString(row.status)?.toLowerCase() === "completed",
      );
      if (failed && !completed) return true;
    }

    const outputText = toolOutputText(data);
    if (!isUnifiedDiffOutput(outputText)) {
      if (outputText.includes(COMMAND_INTERRUPTED_MARKER)) return true;
      if (/^traceback \(most recent call last\)/im.test(outputText)) return true;
    }

    return false;
  }

  if (raw.includes(COMMAND_INTERRUPTED_MARKER)) return true;
  return TOOL_ERROR_HINT.test(raw);
}

/** Status do card: complete | error */
export function inferToolResultStatus(
  toolName: string,
  rawResult: string | null | undefined,
): "complete" | "error" {
  return inferToolFailed(toolName, rawResult) ? "error" : "complete";
}

export function classifyToolOutcome(tool: ToolOutcomeInput): ToolOutcome {
  if (tool.status === "running") return "pending";
  const raw = (tool.result ?? "").trim();
  if (!raw) {
    if (tool.status === "error") return "failed";
    return "pending";
  }
  if (CANCELLED_PREFIX.test(raw)) return "cancelled";
  if (inferToolFailed(tool.name, raw)) return "failed";
  return "completed";
}

export function isOptionalFailureTool(name: string): boolean {
  return OPTIONAL_FAILURE_TOOLS.has(name.trim().toLowerCase());
}

export function turnHasCompensatingSuccess(tools: ToolOutcomeInput[]): boolean {
  return tools.some(
    (tc) =>
      classifyToolOutcome(tc) === "completed" &&
      Boolean((tc.result ?? "").trim()),
  );
}

/** Falha que deve alarmar o usuário no composer (não opcional compensada). */
export function isToolFailureBlocking(
  tool: ToolOutcomeInput,
  turnTools: ToolOutcomeInput[],
): boolean {
  if (classifyToolOutcome(tool) !== "failed") return false;
  if (!isOptionalFailureTool(tool.name)) return true;
  return !turnHasCompensatingSuccess(
    turnTools.filter((tc) => tc !== tool),
  );
}

/** Linha curta pt-BR — espelha agent/tool_result_status.tool_failure_message */
export function toolFailureSummary(tool: ToolOutcomeInput): string | null {
  const raw = (tool.result ?? "").trim();
  if (!raw || !inferToolFailed(tool.name, raw)) return null;

  const data = parseJsonRecord(raw);
  const key = tool.name.trim().toLowerCase();

  if (data) {
    const err = asString(data.error);
    if (err) return humanizeKnownToolError(err).slice(0, 200);

    const status = asString(data.status)?.toLowerCase();
    if (status === "not_found") {
      return "Processo em segundo plano não encontrado";
    }

    if (key === "execute_code" && status === "interrupted") {
      return "Execução interrompida";
    }
    if (key === "execute_code" && status && EXEC_CODE_FAILURE_STATUSES.has(status)) {
      return "Execução falhou";
    }

    const exitCode = data.exit_code;
    if (EXIT_CODE_TOOLS.has(key) && typeof exitCode === "number" && exitCode !== 0) {
      if (exitCode === 130) return "Comando interrompido";
      if (key === "process") return `Processo falhou (código ${exitCode})`;
      return `Comando falhou (código ${exitCode})`;
    }

    const outputText = toolOutputText(data);
    if (outputText.includes(COMMAND_INTERRUPTED_MARKER)) {
      return "Comando interrompido";
    }

    if (key === "delegate_task" && Array.isArray(data.results)) {
      const rows = data.results as JsonRecord[];
      const failed = rows.filter((row) =>
        isDelegateSubagentFailure(asString(row.status) ?? ""),
      ).length;
      const completed = rows.filter(
        (row) => asString(row.status)?.toLowerCase() === "completed",
      ).length;
      if (failed > 0 && completed === 0) {
        return `Delegação falhou (0/${rows.length})`;
      }
      if (failed > 0) {
        return `${completed}/${rows.length} subagentes concluídos`;
      }
    }

    if (key.startsWith("browser_") && err) {
      return humanizeKnownToolError(err).slice(0, 200);
    }
  }

  const first = raw.split("\n", 1)[0]?.trim() ?? "";
  if (first.toLowerCase().startsWith("traceback")) {
    for (const line of raw.split(/\r?\n/).reverse()) {
      if (/error:|exception:/i.test(line)) {
        return line.trim().slice(0, 200);
      }
    }
    return "Erro ao executar";
  }

  if (TOOL_ERROR_HINT.test(raw)) return first.slice(0, 200);
  if (first.toLowerCase().startsWith("failed to take screenshot")) {
    return first.slice(0, 200);
  }
  return first ? first.slice(0, 200) : null;
}
