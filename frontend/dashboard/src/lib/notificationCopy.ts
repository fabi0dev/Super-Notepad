/**
 * Texto das notificações nativas.
 *
 * Duas regras dão o tom:
 *
 * 1. **Varia.** Uma frase fixa lida cinco vezes por dia deixa de ser uma
 *    mensagem e vira um ruído — a pessoa para de ler e passa a reconhecer o
 *    formato. Cada evento tem um punhado de formas, e a mesma nunca sai duas
 *    vezes seguidas.
 * 2. **Chama pelo nome, se houver — mas não sempre e nem sempre no mesmo
 *    lugar.** Variar só a frase não bastou: com o vocativo colado no fim de
 *    toda notificação, o «, Chefe» virava o padrão que se reconhece de longe.
 *    A posição também sorteia — início, fim ou nenhum —, e há formas que se
 *    bastam sozinhas.
 */

import { getNestedValue } from "@/lib/nested";

/**
 * Fecho neutro para a conclusão quando não há resultado concreto a anunciar.
 *
 * A conclusão é a única notificação que é DIRETO AO PONTO: o corpo é sempre o
 * que o turno FEZ (o resumo concreto). Quando não há resumo — resumidor
 * indisponível e cache da conversa fora de memória —, cai neste fecho curto e
 * neutro, nunca numa frase de persona («Acabei aqui, é só dar uma olhada»):
 * ela não diz o que aconteceu e vira ruído para quem só quer o resultado. A
 * persona (vocativo, formas variadas) fica nas notificações de ATENÇÃO
 * (aprovação/pergunta), onde o tom convida a agir; a de conclusão informa.
 */
const CONCLUSAO_CORPO_NEUTRO = "Concluído";

const APROVACAO_TITULO = [
  "Posso seguir?",
  "Preciso da sua decisão",
  "Preciso da sua resposta",
  "Me dá um ok?",
  "Parei aqui esperando você",
  "Preciso de um aval",
] as const;

const APROVACAO_CORPO = [
  "Tem uma ação esperando você aprovar.",
  "Não sigo sem seu ok.",
  "Fico parado até você decidir.",
] as const;

const PERGUNTA_TITULO = [
  "Te fiz uma pergunta",
  "Preciso da sua opinião",
  "Uma dúvida rápida",
  "Queria te perguntar uma coisa",
] as const;

/**
 * Última forma usada por chave, para não repetir em seguida.
 *
 * Sortear puro repete com frequência incômoda — numa lista de quatro, uma
 * repetição imediata a cada quatro avisos —, e repetição imediata é
 * exatamente o que faz parecer texto fixo.
 */
const ultimaEscolha = new Map<string, string>();

export function pickVariation(key: string, options: readonly string[]): string {
  if (options.length === 0) return "";
  if (options.length === 1) return options[0];

  const anterior = ultimaEscolha.get(key);
  const disponiveis = options.filter((o) => o !== anterior);
  const escolhida = disponiveis[Math.floor(Math.random() * disponiveis.length)];
  ultimaEscolha.set(key, escolhida);
  return escolhida;
}

/** Onde o nome entra na frase. */
export type VocativePlacement = "inicio" | "fim" | "nenhum";

const COLOCACOES: readonly VocativePlacement[] = ["inicio", "fim", "nenhum"];

/**
 * Insere o vocativo na posição pedida, respeitando a pontuação.
 *
 * No fim, entra ANTES da pontuação: «Posso seguir, chefe?» e não «Posso
 * seguir?, chefe» — a segunda forma denuncia texto montado por máquina.
 *
 * No início, a primeira letra da frase cai para minúscula: «Chefe, acabei
 * aqui». Vale porque as formas são curadas e todas começam com palavra comum;
 * uma que começasse com nome próprio precisaria de outra regra.
 *
 * O apelido NÃO é alterado — «Maria» continua «Maria». Só a frase se ajusta.
 */
export function applyVocative(
  text: string,
  nickname?: string,
  placement: VocativePlacement = "fim",
): string {
  const nome = nickname?.trim();
  const base = text.trim();
  if (!nome || !base || placement === "nenhum") return base;

  if (placement === "inicio") {
    const resto = base.charAt(0).toLowerCase() + base.slice(1);
    return `${nome}, ${resto}`;
  }

  const match = base.match(/([.!?…]+)$/);
  if (!match) return `${base}, ${nome}`;

  const pontuacao = match[1];
  return `${base.slice(0, -pontuacao.length).trimEnd()}, ${nome}${pontuacao}`;
}

/** Sorteia a colocação, sem repetir a anterior do mesmo evento. */
function pickPlacement(key: string): VocativePlacement {
  return pickVariation(`vocativo:${key}`, COLOCACOES) as VocativePlacement;
}

/**
 * Apelido para o vocativo — só o que a pessoa escolheu ser chamada.
 *
 * De propósito NÃO cai para o e-mail nem para um rótulo genérico como
 * `userFirstNameFromProfile` faz: ali o destino é um menu de conta, onde
 * «Conta» resolve. Aqui o texto é alguém falando com você, e ser chamado de
 * «Conta» — ou pelo pedaço do seu e-mail — é pior que não ser chamado de nada.
 */
export function readNicknameFromConfig(
  config: Record<string, unknown> | null | undefined,
): string | undefined {
  const raw = getNestedValue(config ?? {}, "user.nickname");
  const nickname = String(raw ?? "").trim();
  if (!nickname) return undefined;

  const primeiro = nickname.split(/\s+/)[0]?.trim();
  return primeiro || undefined;
}


/**
 * Resumo da resposta, para a notificação dizer O QUÊ aconteceu.
 *
 * Sem isto o corpo é uma frase canônica — «Deixei a resposta pronta» — que
 * serve para qualquer turno e portanto não informa nenhum. Depois de um
 * commit e push, o aviso precisa dizer que houve commit e push.
 *
 * Regras que a leitura em banner impõe:
 *  - blocos de código ficam de fora: um `git push -u origin ...` como resumo
 *    é ruído, e o comando já está na conversa;
 *  - a primeira linha costuma ser curta demais («Feito ✅»), então junta-se
 *    as seguintes até haver informação de verdade;
 *  - marcação some: negrito e marcadores de lista viram lixo em texto puro.
 */
const RESUMO_MAX = 140;
const RESUMO_MIN_UTIL = 40;

export function summarizeReply(text: string): string | undefined {
  const linhas: string[] = [];
  let dentroDeCodigo = false;

  for (const bruta of text.split("\n")) {
    const linha = bruta.trim();
    if (linha.startsWith("```")) {
      dentroDeCodigo = !dentroDeCodigo;
      continue;
    }
    if (dentroDeCodigo) continue;

    const limpa = stripMarkup(linha);
    if (limpa) linhas.push(limpa);
  }

  if (linhas.length === 0) return undefined;

  let resumo = "";
  for (const linha of linhas) {
    const proximo = resumo ? `${resumo} · ${linha}` : linha;
    if (resumo && proximo.length > RESUMO_MAX) break;
    resumo = proximo;
    if (resumo.length >= RESUMO_MIN_UTIL) break;
  }

  if (resumo.length <= RESUMO_MAX) return resumo;
  return `${resumo.slice(0, RESUMO_MAX - 1).trimEnd()}…`;
}

function stripMarkup(linha: string): string {
  return linha
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function turnCompleteCopy(conversa?: string, resumo?: string) {
  const titulo = conversa?.trim();
  const contexto = resumo?.trim();

  // Direto ao ponto: o corpo é SEMPRE o resultado concreto do turno; sem ele,
  // o fecho neutro. Nada de persona aqui (ver CONCLUSAO_CORPO_NEUTRO).
  //
  // O título da conversa, quando há, diz QUAL conversa terminou — é o que mais
  // ajuda quem tem várias rodando. Sem ele, um rótulo neutro; não inventamos
  // uma frase de persona para ocupar o lugar do título.
  return {
    title: titulo || "Super Note",
    body: contexto || CONCLUSAO_CORPO_NEUTRO,
  };
}

export function approvalCopy(detalhe?: string, nickname?: string) {
  return {
    title: applyVocative(
      pickVariation("aprovacao-titulo", APROVACAO_TITULO),
      nickname,
      pickPlacement("aprovacao"),
    ),
    body: detalhe?.trim() || pickVariation("aprovacao-corpo", APROVACAO_CORPO),
  };
}

export function questionCopy(pergunta: string, nickname?: string) {
  return {
    title: applyVocative(
      pickVariation("pergunta-titulo", PERGUNTA_TITULO),
      nickname,
      pickPlacement("pergunta"),
    ),
    body: pergunta.trim(),
  };
}

/** @internal Testes */
export const __CONCLUSAO_CORPO_NEUTRO_FOR_TESTS = CONCLUSAO_CORPO_NEUTRO;

/** @internal Testes */
export const __VARIATIONS_FOR_TESTS = {
  APROVACAO_TITULO,
  APROVACAO_CORPO,
  PERGUNTA_TITULO,
};

/** @internal Testes */
export function __resetVariationMemoryForTests(): void {
  ultimaEscolha.clear();
}
