import { cva, type VariantProps } from "class-variance-authority";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-xs font-semibold tracking-tight transition-all duration-fast cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
  // Feedback tátil de 'press' em TODO botão — só p/ quem aceita movimento
  // (motion-safe respeita prefers-reduced-motion).
  + " motion-safe:hover:brightness-[1.05] motion-safe:active:scale-[0.94]"
  + " disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        // Ação afirmativa (salvar, conectar, enviar) usa a cor de AÇÃO (verde),
        // não a marca vermelha — vermelho em CTA lê como destrutivo. A marca
        // segue no acento (nav/seleção/hoje); quem realmente quer o botão
        // vermelho usa `brand`; excluir/remover usa `destructive`.
        default:
          "bg-(--action) text-(--action-foreground) hover:bg-(--action-hover)",
        brand: "bg-primary text-primary-foreground hover:bg-primary/85",
        // Ação primária SUTIL, no conceito do Eco ("Gravar"): fundo `--primary-
        // muted` + texto/borda de acento, sem preencher de cor. Vermelho fica só
        // como acento (não um CTA sólido). Use quando o botão verde de `default`
        // pesa demais na tela.
        soft: "border border-solid border-(--border-color) bg-(--primary-muted) text-primary hover:border-(--border-strong)",
        action:
          "bg-(--action) text-(--action-foreground) hover:bg-(--action-hover)",
        destructive: "bg-destructive/15 text-destructive hover:bg-destructive/25",
        outline: "bg-(--surface) hover:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-(--surface-hover) text-muted-foreground hover:text-foreground",
        link: "text-muted-foreground underline-offset-4 hover:underline hover:text-foreground",
      },
      size: {
        default: "min-h-10 px-4 py-2.5 rounded-lg",
        sm: "min-h-9 px-3 py-2 text-xs rounded-md",
        lg: "min-h-11 px-5 py-3 rounded-lg",
        icon: "h-10 w-10 rounded-lg",
        "icon-sm": "h-9 w-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.08 }}
      className={cn(buttonVariants({ variant, size }), className)}
      {...(props as HTMLMotionProps<"button">)}
    />
  );
}
