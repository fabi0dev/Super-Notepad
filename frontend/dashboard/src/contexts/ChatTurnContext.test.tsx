import { describe, expect, it } from "vitest";

// `import.meta.glob` em vez de `fs`: o tsconfig do app é só-browser, e puxar
// @types/node para um teste afrouxaria a tipagem de todo o resto.
const FONTES = import.meta.glob(
  [
    "./ChatTurnContext.tsx",
    "../hooks/queries/useChatChapters.ts",
    "../hooks/queries/useSidebarStatusQuery.ts",
    "../hooks/queries/useGatewayPlatformsQuery.ts",
  ],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

describe("polling com a aba escondida", () => {
  it("todas as consultas periódicas pausam quando ninguém está olhando", () => {
    // A de sessões ativas roda a cada 2 s — era a mais frequente do app e a
    // única sem a guarda. O teste cobre os quatro arquivos para que a próxima
    // consulta periódica nasça com a guarda também.
    const caminhos = Object.keys(FONTES);
    expect(caminhos).toHaveLength(4);

    for (const [caminho, fonte] of Object.entries(FONTES)) {
      expect(fonte, caminho).toContain("refetchInterval");
      expect(fonte, `${caminho} sem guarda de visibilidade`).toContain(
        'document.visibilityState === "hidden"',
      );
    }
  });
});
