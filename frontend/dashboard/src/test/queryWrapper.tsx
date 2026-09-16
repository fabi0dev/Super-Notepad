import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/providers/QueryProvider";

export function createQueryWrapper() {
  const client = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
