import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { type NoteSummary } from "@/lib/api";

/**
 * Arrastar-e-soltar de NOTAS e PASTAS entre pastas — baseado em ponteiro (não
 * HTML5, funciona com mouse real e é testável). `dragOver` = pasta sob o
 * ponteiro (null = nenhuma; "" = raiz); `ghost` = rótulo flutuante seguindo o
 * cursor; `suppressClick` impede o clique-de-seleção/toggle que segue o fim de
 * um arraste.
 *
 * Nota → solta em qualquer pasta (muda o campo `folder`). Pasta → solta em
 * outra pasta (ou raiz) e vira subpasta dela — barrado soltar numa pasta que é
 * ela mesma ou descendente dela (criaria um ciclo).
 */
type DragState =
  | {
      kind: "note";
      id: string;
      title: string;
      parent: string; // pasta atual da nota
      startX: number;
      startY: number;
      active: boolean;
    }
  | {
      kind: "folder";
      path: string; // caminho da própria pasta
      title: string;
      parent: string; // pasta-pai atual
      startX: number;
      startY: number;
      active: boolean;
    };

export function useNoteDrag(
  moveNote: (id: string, folder: string) => void | Promise<void>,
  moveFolder?: (sourcePath: string, targetFolder: string) => void | Promise<void>,
) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(
    null,
  );
  const dragState = useRef<DragState | null>(null);
  const dragOverRef = useRef<string | null>(null);
  const suppressClick = useRef(false);

  // Uma pasta não pode ser solta nela mesma nem numa descendente dela.
  const folderDropAllowed = (source: string, target: string) =>
    target !== source && !(target + "/").startsWith(source + "/");

  // Fim do arraste: solta na pasta sob o ponteiro (via data-folder-path).
  const endDrag = useCallback(() => {
    window.removeEventListener("pointermove", onDragMove);
    document.body.style.userSelect = "";
    const st = dragState.current;
    dragState.current = null;
    const target = dragOverRef.current;
    dragOverRef.current = null;
    setGhost(null);
    setDragOver(null);
    if (st?.active) {
      suppressClick.current = true; // impede o clique/toggle que segue
      if (target != null && target !== st.parent) {
        if (st.kind === "note") {
          void moveNote(st.id, target);
        } else if (moveFolder && folderDropAllowed(st.path, target)) {
          void moveFolder(st.path, target);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveNote, moveFolder]);

  // Move: passado o limiar, ativa o arraste; a cada passo acha a pasta-alvo
  // pelo elemento sob o cursor (o fantasma tem pointer-events: none).
  const onDragMove = useCallback((e: PointerEvent) => {
    const st = dragState.current;
    if (!st) return;
    if (!st.active) {
      const dist = Math.hypot(e.clientX - st.startX, e.clientY - st.startY);
      if (dist < 5) return;
      st.active = true;
      document.body.style.userSelect = "none";
    }
    setGhost({ title: st.title, x: e.clientX, y: e.clientY });
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const target = el?.closest("[data-folder-path]") as HTMLElement | null;
    let path = target ? target.getAttribute("data-folder-path") : null;
    // Pasta: alvos inválidos (ela mesma/descendente) não acendem como destino.
    if (path != null && st.kind === "folder" && !folderDropAllowed(st.path, path)) {
      path = null;
    }
    dragOverRef.current = path;
    setDragOver(path);
  }, []);

  const startNoteDrag = (
    e: ReactPointerEvent<HTMLButtonElement>,
    note: NoteSummary,
  ) => {
    if (e.button !== 0) return;
    dragState.current = {
      kind: "note",
      id: note.id,
      title: note.title || "Sem título",
      parent: note.folder || "",
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag, { once: true });
  };

  const startFolderDrag = (
    e: ReactPointerEvent<HTMLButtonElement>,
    folder: { path: string; name: string },
  ) => {
    if (e.button !== 0) return;
    const parent = folder.path.includes("/")
      ? folder.path.slice(0, folder.path.lastIndexOf("/"))
      : "";
    dragState.current = {
      kind: "folder",
      path: folder.path,
      title: folder.name,
      parent,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag, { once: true });
  };

  // Segurança: se desmontar no meio de um arraste, tira os listeners globais.
  useEffect(
    () => () => {
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", endDrag);
      document.body.style.userSelect = "";
    },
    [onDragMove, endDrag],
  );

  return { dragOver, ghost, suppressClick, startNoteDrag, startFolderDrag };
}
