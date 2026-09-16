import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Tooltip leve do design system — substitui o `title` nativo (atrasado, feio e
 * sem tema). Envolve UM elemento-gatilho e mostra um rótulo flutuante no hover
 * e no foco. Renderiza via portal para não ser cortado por `overflow-hidden`
 * (cards) e segue o tema (superfície `--popover-bg`, sem sombra).
 *
 * Acessibilidade: se o gatilho não tiver `aria-label`, o `content` (quando é
 * texto) vira o rótulo acessível — o `title` que ele substituía já cumpria esse
 * papel.
 *
 * Uso: `<Tooltip content="Arquivar"><button …/></Tooltip>`
 */

type Side = "top" | "bottom";

// Atraso do hover: o rótulo só aparece se o ponteiro ficar parado sobre o
// gatilho, para não piscar quando o mouse só passa por cima a caminho de outro
// lugar. O foco por teclado ignora o atraso (aparece na hora) — quem navegou
// até ali quer a dica agora.
const HOVER_DELAY_MS = 2000;

interface TooltipProps {
  content: ReactNode;
  side?: Side;
  children: ReactElement;
}

function mergeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object")
        (ref as { current: T | null }).current = node;
    }
  };
}

function chain<E>(...fns: (((e: E) => void) | undefined)[]) {
  return (e: E) => {
    for (const fn of fns) fn?.(e);
  };
}

export function Tooltip({ content, side = "top", children }: TooltipProps) {
  const anchorRef = useRef<HTMLElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Prende o rótulo dentro da viewport: perto da borda, o `translate(-50%)`
  // jogava metade dele para fora e o texto vazava/cortava ("ostrar lista").
  // Roda antes do paint, então não pisca.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || !pos) return;
    const margin = 8;
    const half = tip.offsetWidth / 2;
    const min = margin + half;
    const max = window.innerWidth - margin - half;
    tip.style.left = `${Math.round(Math.max(min, Math.min(pos.x, max)))}px`;
  }, [pos]);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: side === "top" ? r.top : r.bottom });
  }, [side]);

  // Hover: espera o atraso antes de mostrar. Foco (teclado): mostra na hora.
  const showAfterDelay = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(place, HOVER_DELAY_MS);
  }, [place]);
  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setPos(null);
  }, []);

  // Timer pendente não pode disparar depois que o gatilho sai da tela.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!isValidElement(children) || content == null || content === "") {
    return children;
  }

  const props = children.props as Record<string, unknown> & {
    ref?: Ref<HTMLElement>;
  };
  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: mergeRefs(anchorRef, props.ref),
    onMouseEnter: chain(
      props.onMouseEnter as (e: unknown) => void,
      showAfterDelay,
    ),
    onMouseLeave: chain(props.onMouseLeave as (e: unknown) => void, hide),
    onFocus: chain(props.onFocus as (e: unknown) => void, place),
    onBlur: chain(props.onBlur as (e: unknown) => void, hide),
    "aria-label":
      (props["aria-label"] as string | undefined) ??
      (typeof content === "string" ? content : undefined),
  });

  return (
    <>
      {trigger}
      {pos &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            className={cn(
              "pointer-events-none fixed z-[120] max-w-xs whitespace-normal break-words rounded-md border border-solid border-(--border-strong)",
              "bg-(--popover-bg) px-2 py-1 text-xs font-medium leading-snug text-foreground shadow-none",
            )}
            style={{
              left: pos.x,
              top: pos.y,
              transform:
                side === "top"
                  ? "translate(-50%, calc(-100% - 6px))"
                  : "translate(-50%, 6px)",
            }}
          >
            {content}
          </span>,
          document.body,
        )}
    </>
  );
}
