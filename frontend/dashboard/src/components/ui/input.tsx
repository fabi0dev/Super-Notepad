import { cn } from "@/lib/utils";
import { forwardRef } from "react";

/** Opt-in border/size/fill for form controls (see `.sn-field` in index.css). */
export const APP_FIELD_CLASS = "sn-field";

/** Shared typography, padding, and focus ring for field controls. */
export const APP_FIELD_INNER_CLASS =
  "w-full min-w-0 bg-transparent px-3 font-sans text-sm placeholder:text-muted-foreground/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(APP_FIELD_CLASS, APP_FIELD_INNER_CLASS, className)}
      {...props}
    />
  );
});
