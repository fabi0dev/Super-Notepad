import type { NoteSummary } from "@/lib/api";

/** Nó da árvore de pastas: a pasta, suas subpastas e as notas diretas dela. */
export interface FolderNode {
  /** Caminho completo ("Trabalho/Projetos") ou "" para a raiz. */
  path: string;
  /** Último segmento, exibido ("Projetos"). */
  name: string;
  children: FolderNode[];
  notes: NoteSummary[];
  /** Total de notas na pasta e em tudo abaixo dela. */
  count: number;
}

/**
 * Monta a árvore a partir da lista plana de pastas e das notas (cada uma com
 * seu `folder`). Pastas vazias (só no registro) também entram. A raiz ("") é o
 * nó de topo; suas `notes` são as sem pasta.
 */
export function buildFolderTree(
  folders: string[],
  notes: NoteSummary[],
): FolderNode {
  const root: FolderNode = { path: "", name: "", children: [], notes: [], count: 0 };
  const byPath = new Map<string, FolderNode>();
  byPath.set("", root);

  const ensure = (path: string): FolderNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join("/");
    const node: FolderNode = { path, name, children: [], notes: [], count: 0 };
    byPath.set(path, node);
    ensure(parentPath).children.push(node);
    return node;
  };

  for (const f of folders) {
    if (f) ensure(f);
  }
  for (const note of notes) {
    const folder = note.folder || "";
    if (folder) ensure(folder);
    (byPath.get(folder) ?? root).notes.push(note);
  }

  // Ordena filhos por nome e conta recursivamente.
  const finalize = (node: FolderNode): number => {
    node.children.sort((a, b) =>
      a.name.localeCompare(b.name, "pt", { sensitivity: "base" }),
    );
    // Notas por DATA DE CRIAÇÃO (mais nova no topo). É uma ordem ESTÁVEL — não
    // muda ao abrir uma nota, ao contrário da recência (updated), que fazia a
    // lista pular a cada clique. `created` é ISO, então compara como string.
    node.notes.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
    let total = node.notes.length;
    for (const child of node.children) total += finalize(child);
    node.count = total;
    return total;
  };
  finalize(root);
  return root;
}

/** Lista achatada de pastas para o menu "Mover para" (raiz + todas). */
export function flatFolderOptions(folders: string[]): { path: string; label: string }[] {
  const opts = [{ path: "", label: "Sem pasta" }];
  for (const f of [...folders].sort((a, b) => a.localeCompare(b, "pt"))) {
    opts.push({ path: f, label: f.replace(/\//g, " / ") });
  }
  return opts;
}
