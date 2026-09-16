import type { ChatMessage, ToolCallEvent } from "./components/types";
import { sanitizeThinkingContent } from "./reasoningLabels";

const THINKING_STRIP_VERBS = [
  "pensando",
  "analisando",
  "avaliando",
  "refletindo",
  "considerando",
  "raciocinando",
  "processando",
  "exploring",
  "thinking",
  "reasoning",
  "investigating",
  "checking",
  "searching",
  "reading",
  "writing",
  "fetching",
  "preparing",
  "running",
  "looking",
];

const THINKING_STATUS_RE = new RegExp(
  `^(?:${THINKING_STRIP_VERBS.join("|")})[\\s.…]*$`,
  "i",
);
const THINKING_STATUS_CHUNK_RE = new RegExp(
  `[^A-Za-zÀ-ÿ\\n]+\\s*(?:${THINKING_STRIP_VERBS.join("|")})[\\s.…]*\\s*`,
  "giu",
);

const EXPLORATION_TOOL_RE =
  /(?:grep|read|search|glob|semantic|explore|find|list|task|codebase|browse|navigate)/i;
const EXECUTION_TOOL_RE = /(?:terminal|shell|bash|execute|run_command)/i;

const HEADLINE_MAX = 120;

const VAGUE_SENTENCE_RE =
  /^(?:bastante|muito|pouco|demais|ok|certo|entendi|hmm|ah|pois|bem|então|logo|agora)(?:[.!…,]\s*|$)/i;
const VAGUE_ACTION_RE =
  /^(?:vou ver (?:o )?resumo|vou conferir|deixa eu ver|vamos ver|preciso ver)(?:[.!…]\s*|$)?/i;
const DEICTIC_ONLY_RE =
  /^(?:isso|aquilo|aqui|ali|lá|já|sim|não)(?:[.!…,]\s*|$)/i;

const INTERNAL_MONOLOGUE_START_RE =
  /^(?:let me|i'll|i will|i need to|i should|i'm going to|i'm in\b|i am in\b|the user is|the user wants|the user asked|since (?:this|it's|that)|first,?\s+i|okay,?\s+i|now,?\s+i|looking at|based on|the (?:code|file|issue|problem|plan|api|response|request|command|output|result|error|data)|i (?:see|think|notice|found|can|should|need|want|am|was|were|have|had|will|would|could|might|may))\b/i;

const ENGLISH_REASONING_START_RE =
  /^(?:investigating|checking|searching|reading|writing|updating|running|using|trying|attempting|considering|evaluating|analyzing|analysing|processing|preparing|fetching|calling|parsing|formatting|implementing|fixing|debugging|testing|verifying|confirming|reviewing|examining|exploring|navigating|opening|closing|creating|deleting|removing|adding|building|compiling|deploying|installing|configuring|looking for|going to|trying to|need to|want to|it seems|this seems|this looks|that looks|maybe|perhaps|probably|actually|okay|ok,|well,|so,|now,|next,|first,|then,|also,|additionally,|however,|therefore,|because|since|in order to|to do this|for this|we (?:need|should|can|will|are)|they (?:are|were|have))\b/i;

const ENGLISH_FUNCTION_WORD_RE =
  /\b(?:the|this|that|with|from|have|will|should|would|could|need|want|user|asked|asking|about|their|they|them|there|when|where|what|which|how|because|since|until|while|although|though|however|therefore|maybe|perhaps|probably|actually|instead|also|just|only|still|already|even|likely|seems|look|looks|like|might|must|can't|cannot|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|i'm|i'll|i've|i'd|we're|we'll|we've|it's|that's|there's|here's|what's|who's|let's|you're|you'll|you've|they're|they'll|they've)\b/gi;

/** Indício de narração ao usuário em pt-BR — não filtrar como monólogo interno. */
const PORTUGUESE_NARRATION_RE =
  /(?:[áéíóúãõç]|\b(?:oi|olá|ola|eai|opa|valeu|obrigad\w*|desculpa|desculpe|por\s+favor|tudo\s+bem|tudo\s+otimo|com\s+voc[eê]|bom\s+dia|boa\s+tarde|boa\s+noite|posso|ajudar|chefe|amigo|em\s+que|o\s+que|como\s+posso|prazer|vou|vamos|não|nao|só|tem|está|esta|estou|beleza|certo|então|entao|dentro|fora|já|ja|agora|usuário|usuario|repositór|arquivo|pasta|diretório|diretorio|listar|conferir|verificar|verifico|investigando|pesquisar|encontrei|achei|buscando|consultando|analisando|revisando|conferindo|listando|executando|preparando|respondendo)\b)/i;

function countEnglishFunctionWords(text: string): number {
  const matches = text.match(ENGLISH_FUNCTION_WORD_RE);
  return matches?.length ?? 0;
}

/** Texto de raciocínio predominantemente em inglês — ocultar na UI pt-BR. */
export function isPredominantlyEnglish(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (PORTUGUESE_NARRATION_RE.test(trimmed)) return false;

  const firstSentence =
    splitSentences(trimmed)[0]?.replace(/[.!?…]+$/g, "").trim() ?? trimmed;
  if (INTERNAL_MONOLOGUE_START_RE.test(firstSentence)) return true;
  if (ENGLISH_REASONING_START_RE.test(firstSentence)) return true;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;

  const englishHits = countEnglishFunctionWords(trimmed);
  if (englishHits >= 2) return true;
  if (words.length >= 4 && englishHits / words.length >= 0.18) return true;

  if (
    words.length >= 3 &&
    !/[áéíóúãõç]/i.test(trimmed) &&
    englishHits >= 1 &&
    !/\b(?:vou|vamos|não|nao|arquivo|pasta|reposit)\b/i.test(trimmed)
  ) {
    return true;
  }

  return false;
}

/** Raciocínio interno do modelo (inglês) que não deve aparecer na timeline. */
export function isInternalModelMonologue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  if (PORTUGUESE_NARRATION_RE.test(trimmed)) return false;

  const firstSentence =
    splitSentences(trimmed)[0]?.replace(/[.!?…]+$/g, "").trim() ?? trimmed;
  if (INTERNAL_MONOLOGUE_START_RE.test(firstSentence)) return true;

  if (
    /^let me\b/i.test(trimmed) &&
    trimmed.length < 320 &&
    !/[áéíóúãõç]/i.test(trimmed)
  ) {
    return true;
  }

  if (isPredominantlyEnglish(trimmed)) return true;

  // Fragmento vago só conta como monólogo quando o texto parece inglês
  // (sem indícios de pt-BR). Cumprimentos curtos sem acento ("Oi, Chefe!")
  // não devem ser descartados do buffer da resposta.
  if (
    !PORTUGUESE_NARRATION_RE.test(trimmed) &&
    !/[áéíóúãõç]/i.test(trimmed) &&
    isDecontextualizedThinkingText(trimmed)
  ) {
    return true;
  }

  return false;
}

const EXPLICIT_TOPIC_RE =
  /\b(?:repositór\w*|git|commit|diff|arquivo\w*|branch\w*|status|mudanç\w*|alteraç\w*|teste\w*|funç\w*|código|projeto|terminal|push|merge|stash|remot\w*|sessão|skill\w*|dependênc\w*)\w*/i;
const EXPLICIT_ACTION_RE =
  /\b(?:verificando|analisando|investigando|preparando|revisando|conferindo|listando|buscando|executando|aplicando|escrevendo|editando|lendo|comitando|fazendo push)\b/i;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Frases soltas do stream sem objeto claro (ex.: «Bastante.», «Vou ver o resumo.»). */
export function isDecontextualizedThinkingText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const sentences = splitSentences(trimmed);
  if (sentences.length === 0) return true;

  return sentences.every((sentence) => {
    const core = sentence.replace(/[.!?…]+$/g, "").trim();
    if (!core) return true;
    if (VAGUE_SENTENCE_RE.test(core)) return true;
    if (VAGUE_ACTION_RE.test(core)) return true;
    if (DEICTIC_ONLY_RE.test(core)) return true;
    if (core.length < 14 && !EXPLICIT_TOPIC_RE.test(core)) return true;
    if (!EXPLICIT_TOPIC_RE.test(core) && !EXPLICIT_ACTION_RE.test(core)) {
      return core.length < 28;
    }
    return false;
  });
}

/** Quanto maior, mais adequado como título visível ao utilizador. */
export function scoreThinkingExplicitness(text: string): number {
  const trimmed = text.trim();
  if (!trimmed || isDecontextualizedThinkingText(trimmed)) return 0;

  let score = Math.min(trimmed.length, 100);
  if (EXPLICIT_ACTION_RE.test(trimmed)) score += 35;
  if (EXPLICIT_TOPIC_RE.test(trimmed)) score += 45;
  if (trimmed.length >= 40) score += 10;
  return score;
}

function pickBestExplicitSentence(cleaned: string): string {
  let best = "";
  let bestScore = 0;

  for (const line of cleaned.split("\n")) {
    for (const sentence of splitSentences(line)) {
      const score = scoreThinkingExplicitness(sentence);
      if (score > bestScore) {
        bestScore = score;
        best = sentence.trim();
      }
    }
    const lineScore = scoreThinkingExplicitness(line.trim());
    if (lineScore > bestScore) {
      bestScore = lineScore;
      best = line.trim();
    }
  }

  return best;
}

export function cleanThinkingText(reasoning: string): string {
  return reasoning
    .split("\n")
    .map((line) => line.replace(THINKING_STATUS_CHUNK_RE, "").trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !THINKING_STATUS_RE.test(line.replace(/\.\.\.$/, "").trim()),
    )
    .join("\n")
    .replace(/([^\n])(?=\*\*[^*\n][^\n]*?\*\*)/g, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitFirstSentence(line: string): { headline: string; rest: string } {
  const match = line.match(/^(.+?[.!?…])(\s+)([\s\S]*)$/);
  if (match && match[1].length <= HEADLINE_MAX) {
    return { headline: match[1].trim(), rest: match[3]?.trim() ?? "" };
  }
  if (line.length <= HEADLINE_MAX) {
    return { headline: line, rest: "" };
  }
  const cut = line.lastIndexOf(" ", HEADLINE_MAX);
  const idx = cut > 40 ? cut : HEADLINE_MAX;
  return {
    headline: `${line.slice(0, idx).trimEnd()}…`,
    rest: line.slice(idx).trim(),
  };
}

export function splitThinkingDisplay(content: string): {
  headline: string;
  detail: string;
} {
  const cleaned = cleanThinkingText(sanitizeThinkingContent(content));
  if (!cleaned) return { headline: "", detail: "" };

  const bestLine = pickBestExplicitSentence(cleaned);
  if (!bestLine) {
    return { headline: "", detail: cleaned };
  }

  const { headline, rest: restOfFirstLine } = splitFirstSentence(bestLine);
  if (isDecontextualizedThinkingText(headline)) {
    return { headline: "", detail: cleaned };
  }

  const withoutHeadline = cleaned
    .split("\n")
    .flatMap((line) => {
      if (line.includes(bestLine)) {
        return line.replace(bestLine, "").trim();
      }
      return [line];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const detailParts = [restOfFirstLine, withoutHeadline].filter(Boolean);
  const detail = detailParts.join("\n").trim();

  return { headline, detail: detail === headline ? "" : detail };
}

function collectToolCalls(msg: ChatMessage): ToolCallEvent[] {
  const fromSegments: ToolCallEvent[] = [];
  for (const segment of msg.segments ?? []) {
    if (segment.kind === "tools") {
      fromSegments.push(...segment.toolCalls);
    }
  }
  if (fromSegments.length > 0) return fromSegments;
  return msg.toolCalls ?? [];
}

/** Fase contextual com rótulo explícito da tool em execução. */
export function resolveThinkingPhase(
  msg: ChatMessage,
  _options?: { streaming?: boolean },
): string {
  const toolCalls = collectToolCalls(msg);
  const running = toolCalls.filter((tc) => tc.status === "running");
  if (running.length === 0) return "";

  const latest = running[running.length - 1];
  const liveLabel = (latest?.liveLabel || "").trim();
  if (liveLabel && !isDecontextualizedThinkingText(liveLabel)) {
    return liveLabel;
  }

  if (latest && EXECUTION_TOOL_RE.test(latest.name)) {
    return "Executando comando no terminal";
  }
  if (latest && EXPLORATION_TOOL_RE.test(latest.name)) {
    return "Explorando o projeto";
  }
  return "";
}
