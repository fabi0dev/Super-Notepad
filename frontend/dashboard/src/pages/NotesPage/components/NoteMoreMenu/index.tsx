import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ClipboardCopy,
  Code,
  Copy,
  Download,
  FileText,
  Folder,
  FolderInput,
  Link2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Printer,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { type Note } from "@/lib/api";
import { flatFolderOptions } from "../../folderTree";

/**
 * Menu "⋯" no fim da barra do editor: ações da nota aberta. Nível 1 traz
 * Duplicar / Copiar vínculo / Mover para pasta… / Apagar; "Mover para pasta"
 * troca para o nível 2 com a lista de pastas (Raiz + todas). Abre por CLIQUE
 * (não é o menu de contexto), num portal para não ser cortado pela barra.
 */
export function NoteMoreMenu({
  note,
  folders,
  onRename,
  onDuplicate,
  onCopyLink,
  onCopyMarkdown,
  onToggleFavorite,
  onToggleLock,
  onExportMd,
  onExportPdf,
  onExportHtml,
  onExportTxt,
  onMove,
  onDelete,
}: {
  note: Note;
  folders: string[];
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onCopyLink: () => void;
  onCopyMarkdown: () => void;
  onToggleFavorite: () => void;
  onToggleLock: () => void;
  onExportMd: () => void;
  onExportPdf: () => void;
  onExportHtml: () => void;
  onExportTxt: () => void;
  onMove: (folder: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "move" | "rename">("root");
  const [moveQuery, setMoveQuery] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setView("root");
    setMoveQuery("");
  }, []);

  const toggle = () => {
    if (open) return close();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setView("root");
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);

  // flatFolderOptions já inclui a raiz como "Sem pasta" (path ""), então não
  // prefixamos outra opção de raiz (senão duplicava).
  const folderOptions = flatFolderOptions(folders);
  const q = moveQuery.trim().toLowerCase();
  const moveFolders = q
    ? folderOptions.filter((o) => o.label.toLowerCase().includes(q))
    : folderOptions;

  const Item = ({
    icon: Icon,
    children,
    danger,
    onClick,
  }: {
    icon: LucideIcon;
    children: ReactNode;
    danger?: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
        danger
          ? "text-destructive hover:bg-destructive/12"
          : "text-muted-foreground hover:bg-(--surface-hover) hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );

  return (
    <>
      <Tooltip content="Mais ações">
        <button
          ref={btnRef}
          type="button"
          onClick={toggle}
          aria-label="Mais ações da nota"
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-(--surface-hover) hover:text-foreground",
            open && "bg-(--surface-hover) text-foreground",
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </Tooltip>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="sn-pop-in fixed z-[130] overflow-hidden rounded-lg border border-solid border-(--border-strong) bg-(--popover-bg) p-1 text-sm shadow-none"
              style={{ top: pos.top, right: pos.right, width: 220 }}
            >
              {view === "root" ? (
                <>
                  <Item
                    icon={Star}
                    onClick={() => { close(); onToggleFavorite(); }}
                  >
                    {note.favorite ? "Desfavoritar" : "Favoritar"}
                  </Item>
                  <Item
                    icon={note.locked ? LockOpen : Lock}
                    onClick={() => { close(); onToggleLock(); }}
                  >
                    {note.locked
                      ? "Desbloquear (liberar ao Super Notepad)"
                      : "Bloquear (ocultar do Super Notepad)"}
                  </Item>
                  <Item
                    icon={Pencil}
                    onClick={() => {
                      setRenameValue(note.title || "");
                      setView("rename");
                    }}
                  >
                    Renomear
                  </Item>
                  <Item icon={Copy} onClick={() => { close(); onDuplicate(); }}>
                    Duplicar
                  </Item>
                  <Item icon={Download} onClick={() => { close(); onExportMd(); }}>
                    Exportar .md
                  </Item>
                  <Item icon={FileText} onClick={() => { close(); onExportTxt(); }}>
                    Exportar .txt
                  </Item>
                  <Item icon={Code} onClick={() => { close(); onExportHtml(); }}>
                    Exportar .html
                  </Item>
                  <Item icon={Printer} onClick={() => { close(); onExportPdf(); }}>
                    Exportar PDF
                  </Item>
                  <Item icon={Link2} onClick={() => { close(); onCopyLink(); }}>
                    Copiar vínculo
                  </Item>
                  <Item
                    icon={ClipboardCopy}
                    onClick={() => { close(); onCopyMarkdown(); }}
                  >
                    Copiar como Markdown
                  </Item>
                  <Item
                    icon={FolderInput}
                    onClick={() => {
                      setMoveQuery("");
                      setView("move");
                    }}
                  >
                    Mover para pasta…
                  </Item>
                  <div className="my-1 h-px bg-(--divider)" role="separator" />
                  <Item icon={Trash2} danger onClick={() => { close(); onDelete(); }}>
                    Apagar
                  </Item>
                </>
              ) : view === "rename" ? (
                <>
                  {/* Voltar + campo de renomear (pré-preenchido, seleciona tudo). */}
                  <div className="flex items-center gap-1 px-1 pb-1">
                    <button
                      type="button"
                      onClick={() => setView("root")}
                      aria-label="Voltar"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-(--surface-hover) hover:text-foreground"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <input
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const name = renameValue.trim();
                          close();
                          if (name) onRename(name);
                        } else if (e.key === "Escape") {
                          setView("root");
                        }
                      }}
                      placeholder="Novo nome…"
                      className="h-7 min-w-0 flex-1 rounded-md border border-solid border-(--border-strong) bg-(--surface) px-2 text-sm text-foreground outline-none focus:border-primary/50"
                    />
                  </div>
                  <div className="my-1 h-px bg-(--divider)" role="separator" />
                  <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
                    Enter para renomear · Esc para voltar
                  </p>
                </>
              ) : (
                <>
                  {/* Voltar + filtro: digitar restringe às pastas que batem. */}
                  <div className="flex items-center gap-1 px-1 pb-1">
                    <button
                      type="button"
                      onClick={() => setView("root")}
                      aria-label="Voltar"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-(--surface-hover) hover:text-foreground"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <input
                      autoFocus
                      value={moveQuery}
                      onChange={(e) => setMoveQuery(e.target.value)}
                      placeholder="Filtrar pasta…"
                      className="h-7 min-w-0 flex-1 rounded-md border border-solid border-(--border-strong) bg-(--surface) px-2 text-sm text-foreground outline-none focus:border-primary/50"
                    />
                  </div>
                  <div className="my-1 h-px bg-(--divider)" role="separator" />
                  <div className="max-h-64 overflow-y-auto">
                    {moveFolders.length ? (
                      moveFolders.map((o) => (
                        <Item
                          key={o.path || "__root__"}
                          icon={Folder}
                          onClick={() => {
                            close();
                            onMove(o.path);
                          }}
                        >
                          {o.label}
                          {note.folder === o.path ? " · atual" : ""}
                        </Item>
                      ))
                    ) : (
                      <p className="px-2.5 py-2 text-sm text-muted-foreground">
                        Nenhuma pasta.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
