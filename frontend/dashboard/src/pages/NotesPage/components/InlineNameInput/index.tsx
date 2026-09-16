import { useRef, useState } from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Campo inline para nomear/renomear pasta ou nota (sem diálogo, estilo Docmost). */
export function InlineNameInput({
  initial = "",
  icon: Icon,
  placeholder = "Nome da pasta",
  pl = "pl-1.5",
  onConfirm,
  onCancel,
}: {
  initial?: string;
  icon?: LucideIcon;
  placeholder?: string;
  pl?: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const submit = () => {
    if (done.current) return;
    done.current = true;
    onConfirm(value);
  };
  return (
    <div className={cn("flex items-center gap-1.5 py-0.5 pr-2", pl)}>
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-primary/80" /> : null}
      <input
        autoFocus
        // Ao renomear, já vem preenchido: seleciona tudo para digitar substituir
        // (comportamento padrão de renomear), sem apagar à mão.
        onFocus={(e) => e.currentTarget.select()}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          else if (e.key === "Escape") {
            done.current = true;
            onCancel();
          }
        }}
        onBlur={submit}
        placeholder={placeholder}
        className="h-7 min-w-0 flex-1 rounded-md border border-solid border-(--border-strong) bg-(--surface) px-2 text-sm text-foreground outline-none focus:border-primary/50"
      />
    </div>
  );
}
