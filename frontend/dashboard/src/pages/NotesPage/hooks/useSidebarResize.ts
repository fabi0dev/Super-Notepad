import { useRef, useState } from "react";

/**
 * Largura da lista de notas (redimensionável arrastando a borda direita).
 * Persistida no dispositivo. Devolve o estado + os handlers de ponteiro da alça.
 */
export function useSidebarResize() {
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 520;
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem("super-notepad.notes.sidebarWidth"));
      if (Number.isFinite(v) && v >= SIDEBAR_MIN && v <= SIDEBAR_MAX) return v;
    } catch {
      /* ignore */
    }
    return 256;
  });
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const latestWidthRef = useRef(sidebarWidth);

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: sidebarWidth };
    latestWidthRef.current = sidebarWidth;
    setResizing(true);
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer sintético/indisponível */
    }
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const st = resizeRef.current;
    if (!st) return;
    const next = Math.min(
      SIDEBAR_MAX,
      Math.max(SIDEBAR_MIN, st.startW + (e.clientX - st.startX)),
    );
    latestWidthRef.current = next;
    setSidebarWidth(next);
  };
  const onResizeEnd = () => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    setResizing(false);
    try {
      localStorage.setItem(
        "super-notepad.notes.sidebarWidth",
        String(latestWidthRef.current),
      );
    } catch {
      /* ignore */
    }
  };

  return {
    sidebarWidth,
    setSidebarWidth,
    resizing,
    onResizeStart,
    onResizeMove,
    onResizeEnd,
  };
}
