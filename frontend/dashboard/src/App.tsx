import { Suspense, lazy, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { DesktopChrome } from "@/components/DesktopChrome";

// App de Notas standalone: um único app (a página de Notas ocupa a tela toda).
// Todo o resto do dashboard do Super Notepad foi deixado de fora do roteamento — este
// entry monta só a NotesPage. Ver README.md.
const NotesPage = lazy(() => import("@/pages/NotesPage"));

export default function App() {
  // Dispensa o splash do index.html assim que o app monta (não há gate de
  // setup como no Super Notepad). Sem isto o spinner só sumiria com a animação de
  // segurança de 12s.
  useEffect(() => {
    (
      window as unknown as { __dismissBootSplash?: () => void }
    ).__dismissBootSplash?.();
  }, []);

  return (
    <>
      {/* Barra de título integrada do app desktop (arraste + slot de ações ao
          lado das bolinhas). No navegador é inerte. */}
      <DesktopChrome />
      <div className="app-shell-in flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground antialiased selection:bg-primary/30">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Suspense
          fallback={
            <div className="flex h-full flex-1 items-center justify-center">
              <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Navigate to="/notas" replace />} />
            <Route path="/notas" element={<NotesPage />} />
            <Route path="/notas/*" element={<NotesPage />} />
            <Route path="*" element={<Navigate to="/notas" replace />} />
          </Routes>
        </Suspense>
        </div>
      </div>
    </>
  );
}
