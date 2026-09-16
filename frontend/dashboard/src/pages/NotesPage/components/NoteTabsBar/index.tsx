import { Lock, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { type NoteSummary } from "@/lib/api";

/**
 * Abas das notas abertas (estilo editor de código): retangulares, separadas por
 * divisórias, a ativa realçada por uma barra no topo e o fundo escuro do
 * conteúdo. O "+" abre uma nota nova numa aba.
 */
export function NoteTabsBar({
  tabItems,
  selectedId,
  setSelectedId,
  closeTab,
  openDraft,
}: {
  tabItems: NoteSummary[];
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  closeTab: (id: string) => void;
  openDraft: () => void;
}) {
  if (tabItems.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="Notas abertas"
      className="ui-scrollbar flex shrink-0 items-stretch overflow-x-auto border-b border-solid border-(--divider)"
    >
      {tabItems.map((n, i) => {
        const active = n.id === selectedId;
        return (
          <div
            key={n.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => setSelectedId(n.id)}
            onMouseDown={(e) => {
              // Botão do meio fecha a aba (como no browser). Fechamos já
              // no MOUSEDOWN — no WKWebView do Tauri o `auxclick`/click do
              // meio não dispara de forma confiável; o mousedown sim.
              // preventDefault também mata o autoscroll do meio.
              if (e.button === 1) {
                e.preventDefault();
                closeTab(n.id);
              }
            }}
            onAuxClick={(e) => {
              // Redundância p/ ambientes onde só o auxclick chega.
              if (e.button === 1) e.preventDefault();
            }}
            onKeyDown={(e) => {
              // Setas ←/→ navegam entre as abas abertas (padrão ARIA).
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const delta = e.key === "ArrowRight" ? 1 : -1;
                const next =
                  tabItems[
                    (i + delta + tabItems.length) % tabItems.length
                  ];
                if (next) setSelectedId(next.id);
              }
            }}
            title={n.title || "Sem título"}
            className={cn(
              "note-tab-enter group/tab relative flex min-w-[7rem] max-w-[13rem] cursor-pointer items-center gap-2 overflow-hidden rounded-t-lg border-r border-solid border-(--divider) px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
              active
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-(--surface-hover) hover:text-foreground",
            )}
          >
            {/* Barra de acento no topo da aba ativa (estilo VS Code). */}
            {active ? (
              <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
            ) : null}
            {n.locked ? (
              <Lock
                className="h-3 w-3 shrink-0 text-muted-foreground"
                aria-label="Bloqueada"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate">
              {n.title || "Sem título"}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(n.id);
              }}
              aria-label="Fechar aba"
              className={cn(
                "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded transition-all hover:bg-(--surface-hover) hover:text-foreground",
                active
                  ? "opacity-70 hover:opacity-100"
                  : "opacity-0 group-hover/tab:opacity-70",
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={openDraft}
        aria-label="Nova aba"
        className="inline-flex shrink-0 items-center justify-center px-3 text-muted-foreground transition-colors hover:bg-(--surface-hover) hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
