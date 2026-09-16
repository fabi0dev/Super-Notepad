import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Menu de contexto (botão direito) do design system.
 *
 * Envolve UM elemento; clicar com o botão direito abre uma lista flutuante no
 * ponteiro, via portal (não é cortada por `overflow-hidden`), no tema do app e
 * sem sombra — separada por luminosidade como o resto da UI. Fecha ao escolher,
 * clicar fora, rolar, redimensionar ou Esc.
 *
 * Uso:
 *   <ContextMenu items={[
 *     { label: "Abrir", icon: ExternalLink, onSelect: () => ... },
 *     "separator",
 *     { label: "Apagar", icon: Trash2, danger: true, onSelect: () => ... },
 *   ]}>
 *     <button>…</button>
 *   </ContextMenu>
 */

export interface ContextMenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export type ContextMenuEntry = ContextMenuItem | "separator";

interface ContextMenuProps {
  items: ContextMenuEntry[];
  children: ReactElement;
  /** Desativa o menu (mantém o filho intacto). */
  disabled?: boolean;
}

const MENU_WIDTH = 208;

export function ContextMenu({ items, children, disabled }: ContextMenuProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Captura para fechar antes de qualquer clique/rolagem consumir o evento.
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close, true);
      window.removeEventListener("blur", close);
    };
  }, [pos, close]);

  const hasActions = items.some((i) => i !== "separator");

  if (!isValidElement(children) || disabled || !hasActions) {
    return children;
  }

  const childProps = children.props as {
    onContextMenu?: (e: MouseEvent) => void;
  };

  const trigger = cloneElement(
    children as ReactElement<{ onContextMenu?: (e: MouseEvent) => void }>,
    {
      onContextMenu: (e: MouseEvent) => {
        childProps.onContextMenu?.(e);
        if (e.defaultPrevented) return;
        e.preventDefault();
        // Posiciona sem estourar a viewport (abre à esquerda/acima se faltar
        // espaço). A altura exata só é conhecida após render, então clampamos
        // o topo por uma estimativa e o portal ajusta o resto no fluxo.
        const margin = 8;
        const estH = Math.min(
          items.length * 34 + 12,
          window.innerHeight - 2 * margin,
        );
        const x = Math.min(e.clientX, window.innerWidth - MENU_WIDTH - margin);
        const y = Math.min(e.clientY, window.innerHeight - estH - margin);
        setPos({ x: Math.max(margin, x), y: Math.max(margin, y) });
      },
    },
  );

  return (
    <>
      {trigger}
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className={cn(
              "sn-pop-in fixed z-[130] min-w-52 overflow-hidden rounded-lg border border-solid",
              "border-(--border-strong) bg-(--popover-bg) p-1 text-sm shadow-none",
            )}
            style={{ left: pos.x, top: pos.y, width: MENU_WIDTH }}
          >
            {items.map((item, i) =>
              item === "separator" ? (
                <div
                  key={`sep-${i}`}
                  className="my-1 h-px bg-(--divider)"
                  role="separator"
                />
              ) : (
                <button
                  key={item.label + i}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
                    "disabled:pointer-events-none disabled:opacity-40",
                    item.danger
                      ? "text-destructive hover:bg-destructive/12"
                      : "text-muted-foreground hover:bg-(--surface-hover) hover:text-foreground",
                  )}
                >
                  {item.icon ? (
                    <item.icon className="h-4 w-4 shrink-0" />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
