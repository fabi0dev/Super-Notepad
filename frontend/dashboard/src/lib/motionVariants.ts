import type { Transition, Variants } from "framer-motion";

export const springTransition: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 32,
  mass: 0.8,
};

/**
 * Mola mais suave e encorpada para layout animations (reorder do bento,
 * expansão de painéis). Menos "elástica" que springTransition — assenta
 * devagar sem overshoot perceptível.
 */
export const softSpring: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 30,
  mass: 1,
};

export const easeTransition = (durationMs: number): Transition => ({
  duration: durationMs / 1000,
  ease: [0.22, 1, 0.36, 1],
});

/**
 * Container de entrada orquestrada: os filhos com `staggerItemVariants`
 * entram em cascata. `staggerMs`/`delayMs` em milissegundos.
 */
export const staggerContainerVariants = (
  staggerMs = 60,
  delayMs = 0,
): Variants => ({
  hidden: {},
  visible: {
    transition: {
      staggerChildren: staggerMs / 1000,
      delayChildren: delayMs / 1000,
    },
  },
  exit: {},
});

export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 12 },
};

export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const dialogPanelVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 8 },
};

export const slideUpVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 12 },
};

export const pageEnterVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

// Sem scale de propósito: escalar texto borra subpixel no WKWebView (Tauri).
export const messageEnterVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

export const noMotionVariants: Variants = {
  hidden: {},
  visible: {},
  exit: {},
};
