/**
 * Lê o primeiro objeto JSON de uma string, mesmo com texto colado depois
 * (notas `[Sistema: …]` que o loop anexa ao resultado da ferramenta).
 */
export function parseLeadingJsonObject(
  raw: string | null | undefined,
): Record<string, unknown> | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (isPlainObject(parsed)) return parsed;
    return null;
  } catch {
    /* JSON puro falhou — tenta o objeto no começo. */
  }
  if (!text.startsWith("{")) return null;
  const end = indexOfMatchingBrace(text);
  if (end < 0) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(0, end + 1));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function indexOfMatchingBrace(text: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
