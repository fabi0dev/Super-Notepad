import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import "./styles/calm.css";
import App from "./App";
import { ThemeProvider } from "./themes";
import { QueryProvider } from "./providers/QueryProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";

// App desktop (Tauri): barra de título integrada, sem a barra cinza. A classe
// na raiz liga o recuo do topo; o sufixo de SO decide os controles de janela.
if ("__TAURI__" in window || "__TAURI_INTERNALS__" in window) {
  const root = document.documentElement;
  root.classList.add("sn-desktop");
  const ua = navigator.userAgent;
  const os = /Windows/i.test(ua)
    ? "win"
    : /Mac|iPhone|iPad/i.test(ua)
      ? "mac"
      : "linux";
  root.classList.add(`sn-os-${os}`);
}

// Tema "minimalismo calmo" (mesma base visual do Super Notepad): cards sem borda, uma
// cor sólida acima do canvas, acento só no glifo.
document.documentElement.classList.add("calm");

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <QueryProvider>
      <ErrorBoundary>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </ErrorBoundary>
    </QueryProvider>
  </BrowserRouter>,
);

// O splash do index.html fica no ar até o app sinalizar que montou (App.tsx
// chama __dismissBootSplash). Um mínimo garante que a saída seja um fade.
{
  const BOOT_MIN_MS = 400;
  const started = performance.now();
  let dispensado = false;
  (
    window as unknown as { __dismissBootSplash?: () => void }
  ).__dismissBootSplash = () => {
    if (dispensado) return;
    dispensado = true;
    const el = document.getElementById("boot-splash");
    if (!el) return;
    const wait = Math.max(0, BOOT_MIN_MS - (performance.now() - started));
    window.setTimeout(() => {
      el.classList.add("boot-done");
      window.setTimeout(() => el.remove(), 550);
    }, wait);
  };
}
