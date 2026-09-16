import { toHomeRelativePath } from "@/lib/composerFooterFormat";
import { getToolDisplayLabel } from "@/lib/toolDisplayLabel";
import { isFileStateGuardMessage } from "@/lib/toolOutcome";

type JsonRecord = Record<string, unknown>;

function parseJsonRecord(raw: string | null | undefined): JsonRecord | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as JsonRecord;
    }
  } catch {
    return null;
  }
  return null;
}

export function isUnifiedDiffOutput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^diff --git /m.test(trimmed)) return true;
  return /^--- /m.test(trimmed) && /^\+\+\+ /m.test(trimmed);
}

export function primaryPathFromDiff(diff: string): string | null {
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const parts = line.split(/\s+/);
      const target = parts[3] ?? parts[2] ?? "";
      const cleaned = target.replace(/^b\//, "").replace(/^a\//, "");
      return cleaned || null;
    }
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim().replace(/^b\//, "");
      if (path && path !== "/dev/null") return path;
    }
  }
  return null;
}

export function shortenToolPath(path: string): string {
  const relative = toHomeRelativePath(path.trim());
  if (relative.startsWith("~/")) return relative.slice(2);
  return relative || path.trim();
}

/** Extrai texto de diff de um resultado JSON (patch, terminal, etc.). */
export function extractDiffTextFromResult(
  rawResult: string | null | undefined,
): string | null {
  const raw = (rawResult ?? "").trim();
  if (!raw) return null;

  const data = parseJsonRecord(raw);
  if (data) {
    const diffField = data.diff;
    if (typeof diffField === "string" && isUnifiedDiffOutput(diffField)) {
      return diffField;
    }
    const output = data.output;
    if (typeof output === "string" && isUnifiedDiffOutput(output)) {
      return output;
    }
  }

  if (isUnifiedDiffOutput(raw)) return raw;
  return null;
}

export function looksLikeRawToolJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  if (parseJsonRecord(trimmed) !== null) return true;
  return /^\{\s*"(?:output|content|diff|error|result|success)"\s*:/.test(trimmed);
}

function pathFromArgs(toolName: string, rawArgs?: string): string | null {
  const parsed = parseJsonRecord(rawArgs ?? "");
  if (!parsed) return null;
  const path = parsed.path;
  if (typeof path === "string" && path.trim()) {
    return shortenToolPath(path);
  }
  const normalized = toolName.trim().toLowerCase();
  if (
    normalized === "terminal" ||
    normalized === "shell" ||
    normalized === "process"
  ) {
    const description = parsed.description;
    if (typeof description === "string" && description.trim()) {
      return description.trim();
    }
    const command = parsed.command;
    if (typeof command === "string" && command.trim()) {
      const cmd = command.trim();
      return cmd.length <= 88 ? cmd : `${cmd.slice(0, 87)}…`;
    }
  }
  return null;
}

/** Título seguro quando formatters devolvem vazio ou JSON bruto vazaria no header. */
export function fallbackToolActionTitle(
  toolName: string,
  rawArgs?: string,
  rawResult?: string,
): string {
  const fromArgs = pathFromArgs(toolName, rawArgs);
  if (fromArgs) return fromArgs;

  const diff = extractDiffTextFromResult(rawResult);
  if (diff) {
    const file = primaryPathFromDiff(diff);
    if (file) return shortenToolPath(file);
    return "Alterações no arquivo";
  }

  const data = parseJsonRecord(rawResult ?? "");
  if (data) {
    const message = data.message ?? data.summary;
    if (typeof message === "string" && message.trim()) {
      const t = message.trim();
      return t.length <= 140 ? t : `${t.slice(0, 137)}…`;
    }
  }

  return getToolDisplayLabel(toolName);
}

export function sanitizeToolActionTitle(
  title: string,
  toolName: string,
  rawArgs?: string,
  rawResult?: string,
): string {
  const trimmed = title.trim();
  if (
    !trimmed ||
    looksLikeRawToolJson(trimmed) ||
    isFileStateGuardMessage(trimmed)
  ) {
    return fallbackToolActionTitle(toolName, rawArgs, rawResult);
  }
  return trimmed;
}
