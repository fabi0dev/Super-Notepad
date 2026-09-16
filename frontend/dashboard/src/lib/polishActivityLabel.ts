import { humanizeProcessWaitLiveLabel } from "@/pages/ChatPage/components/ChatActions/processWaitLabel";
const IRREGULAR_INF_TO_GERUND: Record<string, string> = {
  ser: "sendo",
  ir: "indo",
  ver: "vendo",
  vir: "vindo",
  ter: "tendo",
  poder: "podendo",
  fazer: "fazendo",
  dizer: "dizendo",
  trazer: "trazendo",
  ler: "lendo",
  "pôr": "pondo",
  por: "pondo",
};

const TRAILING_PUNCT = /[.,:;!?).]+$/;
const LEADING_SEPARATORS = /^[\s,:–—-]+/;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function capitalizeSentence(text: string): string {
  if (!text) return text;
  if (text.charAt(0) === text.charAt(0).toUpperCase()) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function infinitiveToGerund(inf: string): string | null {
  const word = inf.toLowerCase().replace(TRAILING_PUNCT, "").trim();
  if (!word) return null;

  const irregular = IRREGULAR_INF_TO_GERUND[word];
  if (irregular) return capitalizeSentence(irregular);

  if (word.endsWith("ar") && word.length > 2) {
    return capitalizeSentence(`${word.slice(0, -2)}ando`);
  }
  if (word.endsWith("er") && word.length > 2) {
    return capitalizeSentence(`${word.slice(0, -2)}endo`);
  }
  if (word.endsWith("ir") && word.length > 2) {
    return capitalizeSentence(`${word.slice(0, -2)}indo`);
  }
  return null;
}

function isGerundWord(word: string): boolean {
  const lower = word.toLowerCase().replace(TRAILING_PUNCT, "");
  return (
    lower.length > 4 &&
    (lower.endsWith("ando") || lower.endsWith("endo") || lower.endsWith("indo"))
  );
}

function isRegularInfinitive(word: string): boolean {
  const lower = word.toLowerCase().replace(TRAILING_PUNCT, "");
  return lower.length >= 4 && /(?:ar|er|ir)$/.test(lower) && !isGerundWord(lower);
}

/** Caminhos, URLs e comandos shell não devem virar frases “humanizadas”. */
export function looksLikeLiteralHint(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^(https?:\/\/|\/|\.\/|\.\.\/|~\/|[A-Za-z]:\\)/.test(t)) return true;
  if (/^(?:git|npm|pnpm|yarn|bun|python|pytest|curl|wget|ssh|docker)\s/i.test(t)) {
    return true;
  }
  if (/^[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,12}$/.test(t)) return true;
  return false;
}

function softenInfinitivePrefix(
  text: string,
  prefix: "vou" | "vamos",
): string | null {
  const match = text.match(new RegExp(`^${prefix}\\s+(\\S+)(.*)$`, "i"));
  if (!match) return null;

  const gerund = infinitiveToGerund(match[1]);
  const rest = match[2].replace(LEADING_SEPARATORS, "");
  if (gerund) return rest ? `${gerund} ${rest}`.trim() : gerund;
  if (rest) return capitalizeSentence(rest);
  return null;
}

function softenEstouPrefix(text: string): string | null {
  const match = text.match(/^estou\s+(\S+)(.*)$/i);
  if (!match) return null;

  const word = match[1].replace(TRAILING_PUNCT, "");
  const rest = match[2].replace(LEADING_SEPARATORS, "");
  if (!isGerundWord(word)) return null;

  const label = capitalizeSentence(word);
  return rest ? `${label} ${rest}`.trim() : label;
}

function softenBareInfinitive(text: string): string | null {
  const match = text.match(/^(\S+)(?:\s+(.*))?$/);
  if (!match) return null;

  const word = match[1];
  if (!isRegularInfinitive(word)) return null;

  const gerund = infinitiveToGerund(word);
  if (!gerund) return null;

  const rest = match[2]?.trim();
  return rest ? `${gerund} ${rest}` : gerund;
}

/**
 * Normaliza rótulos de atividade de tools: tom objetivo em pt-BR, sem "Vou …" repetitivo.
 * Alinhado com `polish_activity_label` no backend/TUI.
 */
export function polishActivityLabel(text: string): string {
  const t = collapseWhitespace(text);
  if (!t || looksLikeLiteralHint(t)) return t;

  const processWait = humanizeProcessWaitLiveLabel(t);
  if (processWait) return processWait;

  return (
    softenInfinitivePrefix(t, "vou") ??
    softenInfinitivePrefix(t, "vamos") ??
    softenEstouPrefix(t) ??
    softenBareInfinitive(t) ??
    capitalizeSentence(t)
  );
}

/** Subtítulo para args técnicos (`path`, `query`, `url`, `command`) — sem reescrever o conteúdo. */
export function formatToolArgHint(text: string, maxLen = 140): string {
  const t = collapseWhitespace(text);
  if (!t) return t;
  if (looksLikeLiteralHint(t)) {
    return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1)}…`;
  }
  const polished = polishActivityLabel(t);
  return polished.length <= maxLen ? polished : `${polished.slice(0, maxLen - 1)}…`;
}
