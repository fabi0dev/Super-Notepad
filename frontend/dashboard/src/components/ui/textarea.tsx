import { cn } from "@/lib/utils";
import { forwardRef } from "react";
import { APP_FIELD_CLASS, APP_FIELD_INNER_CLASS } from "@/components/ui/input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(APP_FIELD_CLASS, APP_FIELD_INNER_CLASS, "py-2", className)}
      {...props}
    />
  );
});
