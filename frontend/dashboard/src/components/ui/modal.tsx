import {
  forwardRef,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/hooks/useBackdropDismiss";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOTION_MS } from "@/lib/motion";
import { dialogPanelVariants, fadeVariants } from "@/lib/motionVariants";
import { useMotionConfig } from "@/hooks/useMotionConfig";

/**
 * Backdrop do modal. Preto forte + blur, NÃO o véu `--overlay` (que casa a cor
 * do fundo: a 80% o texto claro do conteúdo vazava a ~24% e o painel boiava no
 * fundo). Um chão quase preto faz o painel elevado (`bg-card`) destacar por
 * luminosidade e foca o olho no diálogo.
 */
// Véu do modal: usa o token --overlay (near-black no escuro, slate no claro) em
// vez de preto fixo — no tema claro um preto 80% ficava pesado demais.
export const modalOverlayClass =
  "bg-[color-mix(in_srgb,var(--overlay)_80%,transparent)] backdrop-blur-[6px]";

interface ModalProps {
  open: boolean;
  children: ReactNode;
  /** Click on backdrop (outside panel). Omit to disable close on backdrop. */
  onBackdropClick?: () => void;
  className?: string;
  /** Vertical alignment of the panel. */
  align?: "center" | "top";
  zIndexClass?: string;
}

export function Modal({
  open,
  children,
  onBackdropClick,
  className,
  align = "center",
  zIndexClass = "z-50",
}: ModalProps) {
  const { ease } = useMotionConfig();
  // Só fecha quando o clique começou E terminou no backdrop — ver o hook.
  const backdrop = useBackdropDismiss(onBackdropClick);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const node = (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="modal-overlay"
          role="presentation"
          variants={fadeVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={ease(MOTION_MS.fast)}
          className={cn(
            "fixed inset-0 flex p-4",
            zIndexClass,
            modalOverlayClass,
            align === "center"
              ? "items-center justify-center"
              : "items-start justify-center",
            className,
          )}
          {...backdrop}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}

interface ModalPanelProps {
  children: ReactNode;
  className?: string;
  /** aria-labelledby target */
  labelledBy?: string;
  describedBy?: string;
}

export const ModalPanel = forwardRef<HTMLDivElement, ModalPanelProps>(
  function ModalPanel({ children, className, labelledBy, describedBy }, ref) {
    const { spring } = useMotionConfig();

    return (
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        variants={dialogPanelVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        transition={spring}
        className={cn(
          // Borda luminosa: contra o backdrop quase preto, um fio de luz recorta
          // o painel elevado sem sombra (no tema claro some, mas o contraste do
          // backdrop já separa). Mesmo tratamento do painel de Configurações.
          "relative w-full max-w-md overflow-hidden rounded-2xl border border-solid border-white/10",
          "bg-card shadow-none",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    );
  },
);

interface ModalHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
  titleId?: string;
  className?: string;
}

export function ModalHeader({
  title,
  subtitle,
  onClose,
  titleId = "modal-title",
  className,
}: ModalHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b border-(--border-color)/60 px-6 py-4",
        className,
      )}
    >
      <div className="min-w-0 flex-1 pr-6">
        <h2
          id={titleId}
          className="text-base font-semibold leading-snug tracking-tight text-foreground"
        >
          {title}
        </h2>
        {subtitle ? (
          <div className="mt-1.5 text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-(--surface-hover) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function ModalBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("px-6 pb-4", className)}>{children}</div>;
}

export function ModalFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t border-(--border-color)/60 bg-(--surface)/40 px-6 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function panelFocusables(
  panelRef: RefObject<HTMLDivElement | null>,
): HTMLElement[] {
  return Array.from(
    panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
  );
}

/**
 * Elemento que deve receber o foco ao abrir.
 *
 * Sem isto o trap focava o primeiro focável do painel — normalmente o botão
 * de fechar do cabeçalho — e sobrescrevia o `autoFocus` do campo. Marque o
 * campo principal com `data-autofocus` para ele começar focado.
 */
function initialFocusTarget(
  panelRef: RefObject<HTMLDivElement | null>,
): HTMLElement | undefined {
  const preferred =
    panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
  return preferred ?? panelFocusables(panelRef)[0];
}

/**
 * Closes on Escape, locks body scroll, and traps focus inside the panel
 * (Tab/Shift+Tab cycle within it, initial focus moves in on open, previous
 * focus is restored on close). Attach the returned ref to the panel element.
 * O campo marcado com `data-autofocus` recebe o foco inicial, se houver.
 */
export function useModalEscape(onClose: () => void, enabled = true) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus capture/restore + scroll lock: only on the open/close transition,
  // not on every re-render — an unstable `onClose` identity (a fresh arrow
  // function from the caller) must not re-steal focus while the user types.
  useEffect(() => {
    if (!enabled) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    initialFocusTarget(panelRef)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [enabled]);

  // Escape + Tab-trap key handling: safe to rebind on `onClose` changes.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const items = panelFocusables(panelRef);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        const withinPanel = active instanceof Node && panelRef.current.contains(active);
        if (e.shiftKey) {
          if (!withinPanel || active === first) {
            e.preventDefault();
            last.focus();
          }
        } else if (!withinPanel || active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, onClose]);

  return panelRef;
}
