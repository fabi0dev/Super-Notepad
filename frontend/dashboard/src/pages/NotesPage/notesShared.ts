/**
 * Helpers e constantes compartilhados da página de Notas. O componente da rota e
 * os blocos de UI vivem em `index.tsx`/`components/`; aqui ficam formatação,
 * parsing e as chaves de persistência (puros, sem React).
 */

export type SaveState = "idle" | "saving" | "saved" | "error";

/** Id sentinela da aba-rascunho: existe só na UI e NÃO cria nota até digitar. */
export const DRAFT_ID = "__draft__";

// Abas abertas persistidas — fechar uma aba precisa "colar" ao voltar pra tela.
// localStorage (NÃO session): Notas abre em JANELA nova (newWindow), e cada
// janela tem sessionStorage próprio/zerado — então a restauração nunca pegava e
// caíamos no fallback que reabria a primeira nota. Com localStorage o estado
// sobrevive ao fechar/reabrir a janela e ao reinício.
//
// loadOpenTabs devolve `null` quando NUNCA houve estado salvo (primeiro uso) —
// distinto de `[]` (o usuário fechou tudo de propósito). Assim só abrimos uma
// nota por padrão no primeiríssimo acesso; depois, respeitamos "nada aberto".
const TABS_KEY = "supernotepad:notes:open-tabs";
const SEL_KEY = "supernotepad:notes:selected";
export function loadOpenTabs(): string[] | null {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return null;
  }
}
export function saveOpenTabs(ids: string[]): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(ids.filter((id) => id !== DRAFT_ID)));
  } catch {
    /* quota/privacy */
  }
}
export function loadSelected(): string | null {
  try {
    return localStorage.getItem(SEL_KEY);
  } catch {
    return null;
  }
}
export function saveSelected(id: string | null): void {
  try {
    if (id && id !== DRAFT_ID) localStorage.setItem(SEL_KEY, id);
    else localStorage.removeItem(SEL_KEY);
  } catch {
    /* quota/privacy */
  }
}

/** Rótulo da aba-rascunho a partir do markdown (1ª linha, sem marca de heading). */
export function draftLabelFromMarkdown(md: string): string {
  const line = (md || "").split("\n").find((l) => l.trim() !== "") || "";
  return line.replace(/^\s*#{1,6}\s+/, "").trim().slice(0, 60);
}

/**
 * Renomear = editar a PRIMEIRA LINHA do corpo (o título segue a 1ª linha, modelo
 * Obsidian/Notion) — assim a aba e o H1 do editor nunca divergem. Preserva o
 * nível do heading se já houver um; senão cria um H1. Corpo vazio vira "# nome".
 */
export function withRenamedFirstLine(content: string, name: string): string {
  const safe = name.replace(/\r?\n/g, " ").trim();
  const lines = (content ?? "").split("\n");
  const idx = lines.findIndex((l) => l.trim() !== "");
  if (idx === -1) return `# ${safe}\n`;
  const prefix = lines[idx].match(/^(\s*#{1,6}\s+)/)?.[1];
  if (prefix) {
    // Já é um heading: troca só o texto, preservando o nível.
    lines[idx] = `${prefix}${safe}`;
  } else {
    // Primeira linha é CONTEÚDO (texto ou imagem), não um título: insere um H1
    // acima em vez de sobrescrever — senão renomear (ex.: de uma nota criada
    // pelo agente, que começa com texto puro) APAGAVA a primeira linha.
    lines.splice(idx, 0, `# ${safe}`);
  }
  return lines.join("\n");
}

/** Nome de arquivo seguro a partir do título. */
export function safeFileName(title: string, ext: string): string {
  return `${(title || "nota").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "nota"}.${ext}`;
}

/**
 * Nome de pasta como UM segmento só. A "/" é o separador de ANINHAMENTO da
 * árvore (`folderTree` divide o caminho por "/"), e criar subpasta tem caminho
 * próprio ("Nova subpasta"). Logo uma "/" digitada DENTRO do nome não deve virar
 * níveis — senão "Estudos Backend/Devop" aparece como duas pastas aninhadas em
 * vez de uma. Trocamos por solidus fullwidth "／" (mesmo truque do Finder):
 * preserva a aparência da barra sem quebrar em pastas. Também apara barras nas
 * pontas. Não muda nada quando o nome não tem "/".
 */
export function singleFolderSegment(name: string): string {
  return (name || "")
    .trim()
    .replace(/^[/\\]+|[/\\]+$/g, "")
    .replace(/[/\\]+/g, "／")
    .trim();
}
