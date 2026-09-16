import { useEffect, useRef, type ReactNode } from "react";
import { useBackdropDismiss } from "@/hooks/useBackdropDismiss";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MOTION_MS } from "@/lib/motion";
import { dialogPanelVariants, fadeVariants } from "@/lib/motionVariants";
import { useMotionConfig } from "@/hooks/useMotionConfig";
import { modalOverlayClass } from "@/components/ui/modal";

export function ConfirmDialog({
  alertOnly = false,
  cancelLabel = "Cancelar",
  confirmLabel = "Confirmar",
  description,
  destructive = false,
  error,
  loading = false,
  onCancel,
  onConfirm,
  open,
  title,
  warning = false,
  children,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { ease, spring } = useMotionConfig();
  const backdrop = useBackdropDismiss(onCancel);

  // Focus capture/restore + scroll lock: only on the open/close transition,
  // not on every re-render — an unstable `onCancel` identity must not
  // re-steal focus back to the confirm button mid-interaction.
  useEffect(() => {
    if (!open) return;

    const prevActive = document.activeElement as HTMLElement | null;
    dialogRef.current
      ?.querySelector<HTMLButtonElement>("[data-confirm]")
      ?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prevOverflow;
      prevActive?.focus?.();
    };
  }, [open]);

  // Escape + Tab-trap key handling: safe to rebind on `onCancel` changes.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const items = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        const withinDialog =
          active instanceof Node && dialogRef.current.contains(active);
        if (e.shiftKey) {
          if (!withinDialog || active === first) {
            e.preventDefault();
            last.focus();
          }
        } else if (!withinDialog || active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby={description ? "confirm-dialog-desc" : undefined}
          variants={fadeVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={ease(MOTION_MS.fast)}
          {...backdrop}
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center",
            modalOverlayClass,
          )}
        >
          <motion.div
            ref={dialogRef}
            variants={dialogPanelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={spring}
            className={cn(
              "relative w-full max-w-md mx-4",
              "bg-card rounded-xl border border-solid border-(--border-color) shadow-none",
            )}
          >
            <div className="flex items-start gap-3 px-5 pb-4 pt-5">
              {(destructive || warning) && (
                <div
                  aria-hidden
                  className={cn(
                    "mt-px shrink-0",
                    destructive ? "text-destructive" : "text-amber-600",
                  )}
                >
                  <AlertTriangle className="h-[18px] w-[18px]" />
                </div>
              )}

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <h2
                  id="confirm-dialog-title"
                  className="text-base font-semibold leading-snug tracking-tight text-foreground"
                >
                  {title}
                </h2>

                {description && (
                  <p
                    id="confirm-dialog-desc"
                    className="text-sm leading-relaxed text-muted-foreground"
                  >
                    {description}
                  </p>
                )}

                {error && (
                  <p
                    role="alert"
                    className="mt-1 rounded-lg bg-destructive/10 px-3 py-2 text-sm leading-relaxed text-destructive"
                  >
                    {error}
                  </p>
                )}
              </div>
            </div>

            {children ? <div className="px-5 pb-4">{children}</div> : null}

            <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-1">
              {!alertOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onCancel}
                  disabled={loading}
                >
                  {cancelLabel}
                </Button>
              ) : null}
              <Button
                data-confirm
                type="button"
                variant={destructive ? "destructive" : "default"}
                onClick={onConfirm}
                disabled={loading || confirmDisabled}
              >
                {loading ? "…" : confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

interface ConfirmDialogProps {
  /** Um único botão de confirmação (alerta informativo). */
  alertOnly?: boolean;
  cancelLabel?: string;
  confirmLabel?: string;
  description?: string;
  destructive?: boolean;
  /** Falha da última tentativa de confirmar. Mantém o diálogo aberto. */
  error?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  /** Ícone de aviso sem estilo destrutivo. */
  warning?: boolean;
  /** Conteúdo extra entre a descrição e os botões (ex.: caixas de seleção). */
  children?: ReactNode;
  /** Desabilita só o botão de confirmar (ex.: nada selecionado). */
  confirmDisabled?: boolean;
}
