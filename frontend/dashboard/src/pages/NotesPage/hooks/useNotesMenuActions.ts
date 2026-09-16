import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

/**
 * Menu nativo → ações da lista/nota. O lado Rust despacha `supernotepad:menu`;
 * aqui reusamos os mesmos handlers dos botões (para menu e clique concordarem).
 *
 * Efeito autocontido: só instala/remove o listener do CustomEvent. Mantém as
 * MESMAS deps do efeito original (`createNote`, `startCreateFolder`); refs e
 * setters de estado são estáveis.
 */
export function useNotesMenuActions({
  createNote,
  startCreateFolder,
  focusedFolderRef,
  setSidebarOpen,
  setSearchOpen,
  searchInputRef,
}: {
  createNote: (folder?: string, title?: string, content?: string) => void;
  startCreateFolder: (parent?: string) => void;
  focusedFolderRef: RefObject<string>;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setSearchOpen: (v: boolean) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => {
    const onMenu = (e: Event) => {
      const detail = (e as CustomEvent<{
        action?: string;
        name?: string;
        content?: string;
      }>).detail;
      switch (detail?.action) {
        case "new-note":
          void createNote(focusedFolderRef.current);
          break;
        case "new-folder":
          startCreateFolder("");
          break;
        case "toggle-list":
          setSidebarOpen((v) => !v);
          break;
        case "focus-search":
          setSidebarOpen(true);
          setSearchOpen(true);
          setTimeout(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
          }, 0);
          break;
        case "open-file": {
          // "Abrir arquivo…": o Rust já leu o arquivo; criamos uma nota com o
          // conteúdo. O título vem do nome do arquivo (sem extensão).
          const title = (detail.name ?? "Nota importada").replace(/\.[^.]+$/, "");
          void createNote(focusedFolderRef.current, title, detail.content ?? "");
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("supernotepad:menu", onMenu);
    return () => window.removeEventListener("supernotepad:menu", onMenu);
  }, [createNote, startCreateFolder]);
}
