import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Mesmo apelido do vite.config: sem ele qualquer teste que alcance
      // `themes/context.tsx` falha na importação, o que fazia parecer que
      // componentes grandes «não dá para testar».
      "@sn/theme-tokens": path.resolve(
        __dirname,
        "./src/themes/themeTokens.ts",
      ),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
