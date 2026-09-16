import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { MOTION_MS } from "@/lib/motion";
import { slideUpVariants } from "@/lib/motionVariants";
import { useMotionConfig } from "@/hooks/useMotionConfig";

export function Toast({ toast }: { toast: { message: string; type: "success" | "error" } | null }) {
  const [current, setCurrent] = useState(toast);
  const { ease } = useMotionConfig();

  useEffect(() => {
    if (toast) {
      setCurrent(toast);
    }
  }, [toast]);

  return createPortal(
    <AnimatePresence
      onExitComplete={() => {
        if (!toast) setCurrent(null);
      }}
    >
      {toast && current ? (
        <motion.div
          key="toast"
          role="status"
          aria-live="polite"
          variants={slideUpVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={ease(MOTION_MS.toast)}
          className={`fixed top-16 right-4 z-50 max-w-sm rounded-lg border border-solid px-4 py-2.5 text-xs font-semibold tracking-tight lg:top-4 ${
            current.type === "success"
              ? "border-primary/30 bg-primary text-primary-foreground"
              : "border-destructive/30 bg-destructive text-destructive-foreground"
          }`}
        >
          {current.message}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
