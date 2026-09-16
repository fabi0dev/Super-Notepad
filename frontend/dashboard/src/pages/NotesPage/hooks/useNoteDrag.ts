import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { type NoteSummary } from "@/lib/api";

/**
 * Arrastar-e-soltar de notas entre pastas — baseado em ponteiro (não HTML5,
 * funciona com mouse real e é testável). `dragOver` = pasta sob o ponteiro
 * (null = nenhuma; "" = raiz); `ghost` = rótulo flutuante seguindo o cursor;
 * `suppressClick` impede o clique-de-seleção que segue o fim de um arraste.
 */
export function useNoteDrag(
  moveNote: (id: string, folder: string) => void | Promise<void>,
) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(
    null,
  );
  const dragState = useRef<{
    id: string;
    title: string;
    folder: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const dragOverRef = useRef<string | null>(null);
  const suppressClick = useRef(false);

  // Fim do arraste: solta a nota na pasta sob o ponteiro (via data-folder-path).
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
      suppressClick.current = true; // impede o clique-de-seleção que segue
      if (target != null && target !== st.folder) void moveNote(st.id, target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveNote]);

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
    const path = target ? target.getAttribute("data-folder-path") : null;
    dragOverRef.current = path;
    setDragOver(path);
  }, []);

  const startNoteDrag = (
    e: ReactPointerEvent<HTMLButtonElement>,
    note: NoteSummary,
  ) => {
    if (e.button !== 0) return;
    dragState.current = {
      id: note.id,
      title: note.title || "Sem título",
      folder: note.folder || "",
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

  return { dragOver, ghost, suppressClick, startNoteDrag };
}
