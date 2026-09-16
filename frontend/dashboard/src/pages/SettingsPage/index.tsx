import { useNavigate } from "react-router-dom";
import { ArrowLeft, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/themes";
import { cn } from "@/lib/utils";
import { isDesktopApp } from "@/lib/desktopNotifications";

/**
 * Tela de Configurações do Super Note.
 *
 * Expõe o que o app persiste: o tema (claro/escuro/sistema) e o fundo
 * transparente da janela (só no app desktop). Abre pelo menu
 * "Super Note → Configurações…" (⌘,) e pela navegação `/ajustes`.
 */
export default function SettingsPage() {
  const navigate = useNavigate();
  const {
    themeName,
    setTheme,
    transparentBackground,
    setTransparentBackground,
    transparentRestartNeeded,
  } = useTheme();
  const desktop = isDesktopApp();

  const themeOptions = [
    { name: "light", label: "Claro", icon: Sun },
    { name: "dark", label: "Escuro", icon: Moon },
    { name: "system", label: "Sistema", icon: Monitor },
  ] as const;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-(--surface)/30">
      {/* Cabeçalho: voltar + título. */}
      <header className="flex items-center gap-2 border-b border-solid border-(--divider) px-3 py-2">
        <button
          type="button"
          onClick={() => navigate("/notas")}
          aria-label="Voltar para as notas"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-(--surface-hover) hover:text-foreground"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </button>
        <h1 className="text-sm font-semibold tracking-tight">Configurações</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-xl flex-col gap-8 px-5 py-7">
          {/* ── Aparência ─────────────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Aparência
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground/70">
                Tema da interface.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {themeOptions.map((opt) => {
                const active = themeName === opt.name;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.name}
                    type="button"
                    onClick={() => setTheme(opt.name)}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl border border-solid px-3 py-4 text-xs font-medium transition-colors",
                      active
                        ? "border-primary/60 bg-(--primary-muted) text-primary"
                        : "border-(--divider) text-muted-foreground hover:bg-(--surface-hover) hover:text-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Janela (só desktop) ───────────────────────────────────── */}
          {desktop ? (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Janela
                </h2>
              </div>

              <ToggleRow
                title="Fundo transparente"
                description={
                  transparentRestartNeeded
                    ? "Vale no próximo arranque do app."
                    : "Deixa a janela translúcida, com o desfoque do sistema atrás."
                }
                checked={transparentBackground}
                onChange={setTransparentBackground}
              />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Linha de configuração com um interruptor à direita. */
function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-4 rounded-xl border border-solid border-(--divider) px-4 py-3 text-left transition-colors hover:bg-(--surface-hover)"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {description ? (
          <div className="mt-0.5 text-xs text-muted-foreground/80">
            {description}
          </div>
        ) : null}
      </div>
      <span
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-(--divider)",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
