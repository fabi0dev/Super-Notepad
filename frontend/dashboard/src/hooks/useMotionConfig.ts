import { useReducedMotion } from "framer-motion";
import type { Transition } from "framer-motion";
import { MOTION_MS } from "@/lib/motion";
import { easeTransition, softSpring, springTransition } from "@/lib/motionVariants";

interface MotionConfig {
  reduced: boolean;
  initial: false | "hidden";
  transition: Transition;
  spring: Transition;
  softSpring: Transition;
  ease: (ms?: number) => Transition;
}

export function useMotionConfig(): MotionConfig {
  const reduced = useReducedMotion() ?? false;

  const instant: Transition = { duration: 0 };

  return {
    reduced,
    initial: reduced ? false : "hidden",
    transition: reduced ? instant : easeTransition(MOTION_MS.normal),
    spring: reduced ? instant : springTransition,
    softSpring: reduced ? instant : softSpring,
    ease: (ms = MOTION_MS.normal) => (reduced ? instant : easeTransition(ms)),
  };
}
