import { useEffect, type RefObject } from "react";

/**
 * Atalhos da janela de Notas: ⌘N nova nota, ⌘F focar a busca, ⌘S salvar já.
 * (Formatação — negrito/itálico/títulos/listas — vem do próprio editor.)
 *
 * Efeito autocontido: só instala/remove o listener de `keydown`. Recebe os
 * callbacks/setters de que precisa — mantém as MESMAS deps do efeito original
 * (`createNote`, `flush`); refs e setters de estado são estáveis.
 */
export function useNotesKeyboard({
  createNote,
  focusedFolderRef,
  setSidebarOpen,
  setSearchOpen,
  searchInputRef,
  flush,
}: {
  createNote: (folder?: string) => void;
  focusedFolderRef: RefObject<string>;
  setSidebarOpen: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  flush: () => void | Promise<void>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        void createNote(focusedFolderRef.current);
      } else if (k === "f") {
        e.preventDefault();
        setSidebarOpen(true);
        setSearchOpen(true);
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 0);
      } else if (k === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNote, flush]);
}
