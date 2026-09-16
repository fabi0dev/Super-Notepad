import { type MouseEvent } from "react";
import { Minus, Square, X } from "lucide-react";
import {
  closeWindow,
  desktopOS,
  isDesktopApp,
  minimizeWindow,
  startWindowDrag,
  toggleWindowMaximize,
} from "@/lib/desktopNotifications";

/**
 * Barra de título integrada do app desktop.
 *
 * A janela nasce sem a moldura cinza (Overlay no macOS; sem decoração no
 * Windows/Linux). Esta faixa fixa no topo é (a) a área de arraste da janela e
 * (b) a casa dos controles do app: o slot da ESQUERDA (`#sn-titlebar-slot-left`)
 * é preenchido por portal pela página — é onde os ícones de ação (lista, ordenar,
 * nova pasta, nova nota) passam a morar, ao lado das bolinhas, em vez de ficarem
 * soltos no corpo. O CSS de `.sn-titlebar-*` (index.css) desenha tudo; aqui só
 * criamos o DOM e ligamos o arraste/duplo-clique.
 *
 * No navegador (sem Tauri) devolve `null` — a página cai no seu cabeçalho.
 */
export function DesktopChrome() {
  // Síncrono de propósito: o slot precisa existir já no 1º commit, antes de a
  // página ler `getElementById` no seu efeito de montagem. `isDesktopApp()` lê a
  // ponte do Tauri, presente desde o boot (main.tsx já marca `sn-desktop`).
  if (!isDesktopApp()) return null;

  const os = desktopOS();

  // Arrasta a janela ao segurar na faixa — menos quando o clique nasce num
  // controle (botão/link/campo), senão o gesto engoliria o clique do ícone.
  const onDragStart = (e: MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, [data-no-drag]")) {
      return;
    }
    startWindowDrag();
  };

  return (
    <div
      className="sn-titlebar-drag"
      onMouseDown={onDragStart}
      onDoubleClick={() => toggleWindowMaximize()}
    >
      {/* Slot preenchido por portal pela página (ações à esquerda). */}
      <div id="sn-titlebar-slot-left" className="sn-titlebar-slot-left" />

      {/* Controles próprios da janela — só onde não há os nativos do SO. */}
      {os === "win" || os === "linux" ? (
        <div className="sn-win-controls" data-no-drag>
          <button
            type="button"
            aria-label="Minimizar"
            onClick={() => minimizeWindow()}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Maximizar"
            onClick={() => toggleWindowMaximize()}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Fechar"
            className="is-close"
            onClick={() => closeWindow()}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
