import {
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  FileText,
  FolderPlus,
  Link2,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { api, type NoteSummary } from "@/lib/api";
import { cn, isoTimeAgo } from "@/lib/utils";
import { ContextMenu, type ContextMenuEntry } from "@/components/ui/context-menu";
import { type FolderNode } from "../../folderTree";
import { InlineNameInput } from "../InlineNameInput";

export interface NoteTreeProps {
  notes: NoteSummary[];
  tree: FolderNode;
  favorites: NoteSummary[];
  filteredNotes: NoteSummary[] | null;
  folders: string[];
  loading: boolean;
  query: string;
  selectedId: string | null;
  expanded: Set<string>;
  dragOver: string | null;
  suppressClick: RefObject<boolean>;
  renamingPath: string | null;
  renamingNoteId: string | null;
  creatingIn: string | null;
  focusedFolderRef: RefObject<string>;
  openNote: (id: string) => void;
  createNote: (folder?: string, title?: string, content?: string) => void;
  startCreateFolder: (parent?: string) => void;
  confirmCreateFolder: (name: string) => void;
  confirmRenameFolder: (path: string, name: string) => void;
  confirmRenameNote: (id: string, name: string) => void;
  deleteFolder: (path: string) => void;
  deleteNote: (id: string) => void;
  duplicateNote: (n: NoteSummary) => void;
  toggleFavorite: (n: NoteSummary) => void;
  copyNoteLink: (n: NoteSummary) => void;
  exportMarkdown: (n: NoteSummary, content: string) => void;
  toggleFolder: (path: string) => void;
  startNoteDrag: (e: ReactPointerEvent<HTMLButtonElement>, note: NoteSummary) => void;
  startFolderDrag: (
    e: ReactPointerEvent<HTMLButtonElement>,
    folder: { path: string; name: string },
  ) => void;
  setRenamingPath: Dispatch<SetStateAction<string | null>>;
  setRenamingNoteId: Dispatch<SetStateAction<string | null>>;
  setCreatingIn: Dispatch<SetStateAction<string | null>>;
  setQuery: Dispatch<SetStateAction<string>>;
}

/**
 * Árvore da sidebar: favoritos + pastas/notas (ou resultados de busca), com os
 * menus de contexto de pasta e nota, criação/renome inline e a área-raiz que é
 * alvo de soltura do arraste. Recebe TODO o estado e os handlers como props a
 * cada render (sem memo) — os valores acompanham a página sem stale-closure.
 */
export function NoteTree({
  notes,
  tree,
  favorites,
  filteredNotes,
  folders,
  loading,
  query,
  selectedId,
  expanded,
  dragOver,
  suppressClick,
  renamingPath,
  renamingNoteId,
  creatingIn,
  focusedFolderRef,
  openNote,
  createNote,
  startCreateFolder,
  confirmCreateFolder,
  confirmRenameFolder,
  confirmRenameNote,
  deleteFolder,
  deleteNote,
  duplicateNote,
  toggleFavorite,
  copyNoteLink,
  exportMarkdown,
  toggleFolder,
  startNoteDrag,
  startFolderDrag,
  setRenamingPath,
  setRenamingNoteId,
  setCreatingIn,
  setQuery,
}: NoteTreeProps) {
  // Itens de menu de uma nota. Mover ficou só no arraste (com o mouse), então
  // não polui o menu com uma linha por pasta.
  const noteMenu = (n: NoteSummary): ContextMenuEntry[] => [
    { label: "Abrir", icon: FileText, onSelect: () => openNote(n.id) },
    {
      label: n.favorite ? "Desfavoritar" : "Favoritar",
      icon: Star,
      onSelect: () => toggleFavorite(n),
    },
    { label: "Renomear", icon: Pencil, onSelect: () => setRenamingNoteId(n.id) },
    { label: "Duplicar", icon: Copy, onSelect: () => void duplicateNote(n) },
    {
      label: "Copiar vínculo",
      icon: Link2,
      onSelect: () => copyNoteLink(n),
    },
    {
      label: "Exportar .md",
      icon: Download,
      onSelect: () =>
        void api
          .notesGet(n.id)
          .then((full) => exportMarkdown(n, full.content ?? ""))
          .catch(() => {}),
    },
    "separator",
    {
      label: "Apagar",
      icon: Trash2,
      danger: true,
      onSelect: () => void deleteNote(n.id),
    },
  ];

  // A indentação/hierarquia vem dos containers com borda-guia (ver renderFolder),
  // então a linha em si tem só um respiro fixo à esquerda.
  const noteRow = (n: NoteSummary) =>
    renamingNoteId === n.id ? (
      <InlineNameInput
        key={n.id}
        initial={n.title}
        placeholder="Nome da nota"
        pl="pl-6"
        onConfirm={(name) => void confirmRenameNote(n.id, name)}
        onCancel={() => setRenamingNoteId(null)}
      />
    ) : (
    <ContextMenu key={n.id} items={noteMenu(n)}>
      <button
        type="button"
        onPointerDown={(e) => startNoteDrag(e, n)}
        onClick={() => {
          // Se acabou um arraste, o clique que o segue não deve selecionar.
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          openNote(n.id);
        }}
        className={cn(
          // `select-none`: idem pasta — evita o botão direito selecionar o
          // título e o WKWebView abrir o "Copiar ⌘C" nativo sobre o menu custom.
          "group relative flex h-8 w-full select-none items-center gap-2 rounded-md pl-6 pr-2 text-left transition-colors",
          // Entrada suave só fora da busca — durante a busca a lista filtra a
          // cada tecla e re-animar aqui deixaria o sidebar "piscando".
          !query.trim() && "list-stagger-item",
          n.id === selectedId
            ? "bg-(--primary-muted) font-medium text-foreground"
            : "text-muted-foreground hover:bg-(--surface-hover) hover:text-foreground",
        )}
      >
        {n.id === selectedId ? (
          <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
        ) : null}
        <span className="flex-1 whitespace-nowrap text-sm">
          {n.title || "Sem título"}
        </span>
        {n.favorite ? (
          <Star
            className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
            aria-label="Favorita"
          />
        ) : null}
        <span className="shrink-0 text-2xs text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60">
          {n.updated ? isoTimeAgo(n.updated) : ""}
        </span>
      </button>
    </ContextMenu>
    );

  const folderMenu = (path: string): ContextMenuEntry[] => [
    { label: "Nova nota aqui", icon: FilePlus2, onSelect: () => void createNote(path) },
    { label: "Nova subpasta", icon: FolderPlus, onSelect: () => startCreateFolder(path) },
    { label: "Renomear", icon: Pencil, onSelect: () => setRenamingPath(path) },
    "separator",
    {
      label: "Apagar pasta",
      icon: Trash2,
      danger: true,
      onSelect: () => void deleteFolder(path),
    },
  ];

  const renderFolder = (node: FolderNode): ReactNode => {
    const isOpen = expanded.has(node.path);
    const isDropTarget = dragOver === node.path;
    if (renamingPath === node.path) {
      return (
        <div key={node.path} data-folder-path={node.path}>
          <InlineNameInput
            initial={node.name}
            onConfirm={(name) => void confirmRenameFolder(node.path, name)}
            onCancel={() => setRenamingPath(null)}
          />
        </div>
      );
    }
    return (
      <div key={node.path} data-folder-path={node.path}>
        <ContextMenu items={folderMenu(node.path)}>
          <button
            type="button"
            onPointerDown={(e) =>
              startFolderDrag(e, { path: node.path, name: node.name })
            }
            onClick={() => {
              // Se acabou de arrastar, não alterna (o clique-de-fim-de-arraste).
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              toggleFolder(node.path);
            }}
            aria-expanded={isOpen}
            aria-label={`Pasta ${node.name}`}
            className={cn(
              // `select-none`: sem isto, o botão direito SELECIONAVA o nome da
              // pasta e o WKWebView abria o menu NATIVO "Copiar ⌘C" POR CIMA do
              // nosso menu de contexto (dois menus). O menu custom já dá
              // preventDefault; falta impedir a seleção.
              "group flex h-8 w-full select-none items-center gap-1.5 rounded-md pl-1.5 pr-1.5 text-left text-muted-foreground transition-colors hover:bg-(--surface-hover)",
              isDropTarget &&
                "bg-(--primary-muted) ring-1 ring-inset ring-primary/40",
            )}
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform",
                isOpen && "rotate-90",
              )}
            />
            <span className="flex-1 whitespace-nowrap text-sm text-foreground">
              {node.name}
            </span>
            {/* Ação rápida no hover: nova nota dentro da pasta. */}
            <span
              role="button"
              tabIndex={-1}
              aria-label="Nova nota nesta pasta"
              onClick={(e) => {
                e.stopPropagation();
                void createNote(node.path);
              }}
              className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-(--surface-hover) hover:text-foreground group-hover:flex"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
            </span>
            <span className="w-5 shrink-0 text-right text-2xs text-muted-foreground/60 group-hover:hidden">
              {node.count}
            </span>
          </button>
        </ContextMenu>
        {isOpen ? (
          // Container com borda-guia: a linha vertical mostra a hierarquia
          // (estilo Docmost/VSCode); a margem indenta o nível. Ao abrir, o
          // conteúdo entra com um fade+slide sutil (note-tree-reveal).
          <div className="notes-tree-guide note-tree-reveal ml-[15px] pl-2">
            {creatingIn === node.path ? (
              <InlineNameInput
                onConfirm={(name) => void confirmCreateFolder(name)}
                onCancel={() => setCreatingIn(null)}
              />
            ) : null}
            {node.children.map((child) => renderFolder(child))}
            {node.notes.map((n) => noteRow(n))}
          </div>
        ) : null}
      </div>
    );
  };

  const treeContent = loading ? (
    <p className="px-3 py-4 text-sm text-muted-foreground">Carregando…</p>
  ) : filteredNotes ? (
    filteredNotes.length === 0 ? (
      <div className="flex flex-col items-start gap-2 px-3 py-4">
        <p className="text-sm text-muted-foreground">
          Nenhuma nota para “{query.trim()}”.
        </p>
        <button
          type="button"
          onClick={() => {
            const title = query.trim();
            setQuery("");
            void createNote("", title, `# ${title}\n\n`);
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-(--primary-muted) px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-(--surface-hover)"
        >
          <Plus className="h-3.5 w-3.5" />
          Criar nota “{query.trim()}”
        </button>
      </div>
    ) : (
      <div>
        <p className="px-3 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground/60">
          {filteredNotes.length}{" "}
          {filteredNotes.length === 1 ? "resultado" : "resultados"}
        </p>
        {filteredNotes.map((n) => noteRow(n))}
      </div>
    )
  ) : notes.length === 0 && folders.length === 0 && creatingIn !== "" ? (
    <p className="px-3 py-4 text-sm text-muted-foreground">
      Nenhuma nota ainda. Crie a primeira.
    </p>
  ) : (
    <div>
      {creatingIn === "" ? (
        <InlineNameInput
          onConfirm={(name) => void confirmCreateFolder(name)}
          onCancel={() => setCreatingIn(null)}
        />
      ) : null}
      {favorites.length > 0 ? (
        <div className="mb-1">
          <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground/70">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Favoritas
          </div>
          {favorites.map((n) => (
            <div key={`fav-${n.id}`}>{noteRow(n)}</div>
          ))}
          <div className="my-1.5 h-px bg-(--divider)" />
        </div>
      ) : null}
      {tree.children.map((child) => renderFolder(child))}
      {tree.notes.map((n) => noteRow(n))}
    </div>
  );

  return (
    // Toda a área da lista: alvo de soltura da raiz + menu de contexto
    // (botão direito no vazio) para criar nota/pasta na raiz.
    <ContextMenu
      items={[
        {
          label: "Nova nota",
          icon: FilePlus2,
          onSelect: () => void createNote(focusedFolderRef.current),
        },
        {
          label: "Nova pasta",
          icon: FolderPlus,
          onSelect: () => startCreateFolder(""),
        },
      ]}
    >
      <div
        data-folder-path=""
        className={cn(
          // Rola nos dois eixos: pastas fundas e nomes longos passam a
          // ser alcançáveis rolando na horizontal, em vez de cortados.
          "notes-tree-scroll min-h-0 flex-1 overflow-auto px-1.5 pb-2",
          dragOver === "" && "bg-(--primary-muted)/40",
        )}
      >
        {/* `w-max min-w-full`: preenche a largura visível (linhas cheias)
            mas cresce até o item mais largo — o que gera o scroll-x. */}
        <div className="w-max min-w-full">{treeContent}</div>
      </div>
    </ContextMenu>
  );
}
