import { decodeHtmlEntities } from "@/lib/decodeHtmlEntities";

const SSE_TEXT_LIKE_KINDS = new Set([
  "TEXT",
  "REASONING",
  "THINKING",
  "STATUS",
]);

const nfc = (value: string): string => value.normalize("NFC");

function suffixPrefixOverlapLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length, 512);
  for (let len = max; len >= 2; len -= 1) {
    if (left.endsWith(right.slice(0, len))) return len;
  }
  return 0;
}

/** Insere espaço quando o provider partiu o token entre letra e número (ex. `Só` + `6.6GB`). */
export function shouldInsertSpaceBetweenChunks(
  left: string,
  right: string,
): boolean {
  if (!left || !right) return false;
  const l = left.slice(-1);
  const r = right.slice(0, 1);
  if (/\s/.test(l) || /\s/.test(r)) return false;
  // Nunca inserir espaço colado a delimitadores markdown (`*` `_` `` ` `` `#`).
  if (/[*_`#]$/.test(l) || /^[*_`#]/.test(r)) return false;
  if (/[.,;:!?…)\]}"'`»]/.test(l)) return false;
  if (/[([{"'«]/.test(r)) return false;
  if (!/[0-9A-Za-zÀ-ÿ]/.test(l) || !/^[0-9A-Za-zÀ-ÿ]/.test(r)) return false;
  // Cores CSS / hex: `#3`+`A8BAD`, `#2C6`+`FA1` — não partir o token.
  if (/#[0-9A-Fa-f]{0,7}$/i.test(left) && /^[0-9A-Fa-f]/i.test(right)) {
    return false;
  }
  // Hash git / token hex em progresso: `43`+`f9f8c`, `e301`+`e3b`, `abc..d`+`ef12`.
  // Não confundir com prosa `de`+`228GB` (palavra direita não é hex puro).
  if (isHexHashContinuation(left, right)) {
    return false;
  }
  const leftEndsLetter = /[A-Za-zÀ-ÿ]$/.test(left);
  const rightStartsDigit = /^[0-9]/.test(right);
  const leftEndsDigit = /[0-9]$/.test(left);
  const rightStartsLetter = /^[A-Za-zÀ-ÿ]/.test(right);
  return (
    (leftEndsLetter && rightStartsDigit) ||
    (leftEndsDigit && rightStartsLetter)
  );
}

/** Fronteira letra↔dígito que continua um hash/range hex (não prosa). */
function isHexHashContinuation(left: string, right: string): boolean {
  if (!/[0-9a-fA-F]$/.test(left) || !/^[0-9a-fA-F]/.test(right)) {
    return false;
  }
  const rightWord = right.match(/^[^\s]+/)?.[0] ?? "";
  if (!/^[0-9a-fA-F]+(?:\.\.[0-9a-fA-F]*)?$/i.test(rightWord)) {
    return false;
  }
  const leftToken = left.match(/[0-9a-fA-F]+(?:\.\.[0-9a-fA-F]*)?$/i)?.[0] ?? "";
  // Exige dígito, `..`, ou ≥3 hex: evita `de`+`228` (preposição + número).
  return (
    leftToken.length >= 3 ||
    /\d/.test(leftToken) ||
    leftToken.includes("..")
  );
}

/**
 * Remove resposta colada duas vezes (mesma metade repetida), ex. após
 * reenvio do final + stream.
 *
 * Deliberadamente conservador: só colapsa quando a metade repetida é longa
 * o bastante para uma coincidência byte-a-byte ser praticamente impossível
 * em texto gerado natural. Um limite baixo (usado antes) apagava conteúdo
 * legítimo — ex. o usuário pede para repetir uma frase curta, ou a resposta
 * tem duas listas coincidentemente idênticas — silenciosamente perdendo a
 * segunda metade real.
 */
const MIN_HALF_LENGTH_TO_COLLAPSE = 80;

/**
 * Abaixo disso, tratar `curN.endsWith(nextN)` como "chunk já aplicado" é
 * ambíguo demais: uma letra dobrada (ex. "voo") partida entre dois deltas
 * de 1 char cada faz o segundo "o" coincidir com o fim do que já foi
 * mostrado, e essa checagem descartava o caractere inteiro — a palavra
 * saía como "vo". Só descartar quando a coincidência é longa o bastante
 * para não ser uma letra/sílaba repetida naturalmente.
 */
const MIN_SUFFIX_DUPLICATE_LENGTH = 8;

export function collapseRepeatedHalf(value: string): string {
  let next = value;
  while (
    next.length >= MIN_HALF_LENGTH_TO_COLLAPSE * 2 &&
    next.length % 2 === 0
  ) {
    const half = next.length / 2;
    if (half < MIN_HALF_LENGTH_TO_COLLAPSE) break;
    const left = next.slice(0, half);
    const right = next.slice(half);
    if (nfc(left) !== nfc(right)) break;
    next = left;
  }
  return next;
}

export function mergeAssistantStreamChunk(current: string, text: string): string {
  if (!text) return current;
  if (!current) return collapseRepeatedHalf(text);

  const curN = nfc(current);
  const nextN = nfc(text);

  if (nextN.startsWith(curN)) return collapseRepeatedHalf(text);
  if (nextN === curN) return current;
  if (nextN.length >= MIN_SUFFIX_DUPLICATE_LENGTH && curN.endsWith(nextN)) {
    return current;
  }

  const overlap = suffixPrefixOverlapLength(current, text);
  const appended = text.slice(overlap);
  if (!appended) return collapseRepeatedHalf(current);

  const joiner = shouldInsertSpaceBetweenChunks(current, appended) ? " " : "";
  return collapseRepeatedHalf(current + joiner + appended);
}

/** Junta linhas `data:` de um bloco SSE (suporta CRLF e várias linhas data por evento). */
export function parseSseDataPayload(block: string): string | null {
  const trimmed = block.trim();
  if (!trimmed) return null;
  const lines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const dataLines = lines.filter((line) => /^data:\s*/i.test(line));
  if (dataLines.length === 0) return null;
  return dataLines.map((line) => line.replace(/^data:\s*/i, "")).join("\n");
}

export function parseSseEventKind(data: string): {
  kind: string;
  payload: string;
} {
  const separator = data.indexOf("|");
  if (separator < 0) {
    return { kind: data, payload: "" };
  }
  const kind = data.slice(0, separator);
  const rawSlice = data.slice(separator + 1);
  // Only text-like kinds were escaped server-side to protect the SSE "data:"
  // line framing — undo that here. The server escapes the backslash too
  // (`\` -> `\\`) BEFORE the newline (`\n` -> `\\n`), so a literal `\n` in the
  // assistant text (code, regex, shown JSON) survives the round trip instead
  // of turning into a real newline. Reverse the PAIR in a single pass: `\\`
  // back to `\` and `\n` back to a newline — a plain `/\\n/g` would eat the
  // escaped backslash. JSON-payload kinds (WISER_REQUEST, TOOL_*,
  // APPROVAL_REQUEST, ...) are not escaped/reversed: they carry their own JSON
  // string escaping and unescaping there would break JSON.parse.
  const payload = SSE_TEXT_LIKE_KINDS.has(kind)
    ? decodeHtmlEntities(
        rawSlice.replace(/\\([\\n])/g, (_m, c) => (c === "n" ? "\n" : "\\")),
      )
    : rawSlice;
  return { kind, payload };
}

export const PLACEHOLDER_TOOL_NAME = "tool";

export function normalizeSseToolName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return PLACEHOLDER_TOOL_NAME;
  }
  if (trimmed.length > 96) return PLACEHOLDER_TOOL_NAME;
  return trimmed;
}

/** Infere nome real quando o backend envia placeholder ou string vazia. */
export function resolveSseToolName(
  rawName: string,
  technical?: string,
): string {
  const normalized = normalizeSseToolName(rawName);
  if (normalized !== PLACEHOLDER_TOOL_NAME) return normalized;
  const tech = (technical || "").trim();
  if (!tech) return normalized;
  const prefix = tech.split(":")[0]?.trim() ?? "";
  const inferred = normalizeSseToolName(prefix);
  return inferred !== PLACEHOLDER_TOOL_NAME ? inferred : normalized;
}

export type ToolProgressPayload = {
  eventType: string;
  toolName: string;
  toolId?: string;
  preview: string;
  technical: string;
};

export function parseToolProgressPayload(payload: string): ToolProgressPayload {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed === "object" && parsed !== null) {
      const data = parsed as Record<string, unknown>;
      return {
        eventType: typeof data.event === "string" ? data.event.trim() : "",
        toolName: normalizeSseToolName(
          typeof data.name === "string" ? data.name : "tool",
        ),
        toolId:
          typeof data.id === "string" && data.id.trim()
            ? data.id.trim()
            : undefined,
        preview:
          typeof data.preview === "string" ? data.preview.trim() : "",
        technical:
          typeof data.technical === "string" ? data.technical.trim() : "",
      };
    }
  } catch {
    /* legacy pipe format */
  }
  const [eventTypeRaw, toolNameRaw, ...previewParts] = payload.split("|");
  return {
    eventType: (eventTypeRaw || "").trim(),
    toolName: normalizeSseToolName(toolNameRaw || "tool"),
    preview: previewParts.join("|").trim(),
    technical: "",
  };
}
