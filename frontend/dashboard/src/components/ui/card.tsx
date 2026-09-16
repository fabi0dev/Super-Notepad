import { cn } from "@/lib/utils";

/**
 * Estilo canônico de card (shadcn) — superfície `--card-bg`, borda visível
 * (opt-in `border-solid`, pois o reset global zera `border`), cantos e sem
 * sombra. Exportado para telas que precisam do MESMO visual num elemento que
 * não é `<div>` (ex.: um card clicável que é `<button>`): use
 * `cn(cardClass, …)` em vez de recriar as classes à mão. Assim todos os cards
 * saem do mesmo lugar e ficam idênticos nos dois temas.
 */
export const cardClass =
  "rounded-xl border border-solid border-(--border-color) bg-(--card-bg) shadow-none app-surface";

/**
 * Superfície FLUTUANTE (menus, dropdowns, popovers) — um degrau acima do card:
 * fundo elevado `--popover-bg` e borda mais firme `--border-strong` para
 * recortar sobre o conteúdo. Sem sombra (separação por luminosidade, como o
 * resto da UI). O call-site adiciona posição/z/largura (`absolute … z-50 w-…`).
 */
export const popoverSurfaceClass =
  "overflow-hidden rounded-xl border border-solid border-(--border-strong) bg-(--popover-bg) shadow-none";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("w-full text-card-foreground", cardClass, className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 px-4 pt-4 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold text-foreground/90", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-muted-foreground leading-relaxed", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-0", className)} {...props} />;
}
