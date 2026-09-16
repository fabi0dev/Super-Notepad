import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: true,
        staleTime: 30_000,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createAppQueryClient);

  return (
    <QueryClientProvider client={client}>
      {children}
      {/* Só no dev server: `import.meta.env.DEV` é false no build, então o
          bloco é eliminado e o pacote não entra no bundle que o `super_notepad`
          serve. Canto inferior DIREITO — em bottom-left o botão flutuante
          caía exatamente sobre a linha de conta da sidebar. */}
      {import.meta.env.DEV ? (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      ) : null}
    </QueryClientProvider>
  );
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}
