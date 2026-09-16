import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Backend do app de Notas (python -m super_notepad, porta 9010 por padrao).
const BACKEND = process.env.SUPER_NOTEPAD_DASHBOARD_URL ?? "http://127.0.0.1:9010";

/**
 * In production the Python `python -m super_notepad` server injects a one-shot
 * session token into `index.html` (see `super_notepad/web_server.py`). The
 * Vite dev server serves its own `index.html`, so unless we forward that
 * token, every protected `/api/*` call 401s.
 *
 * This plugin fetches the running dashboard's `index.html` on each dev page
 * load, scrapes the `window.__SUPER_NOTEPAD_SESSION_TOKEN__` assignment, and
 * re-injects it into the dev HTML. No-op in production builds.
 */
function superNotepadDevToken(): Plugin {
  const TOKEN_RE = /window\.__SUPER_NOTEPAD_SESSION_TOKEN__\s*=\s*"([^"]+)"/;
  const FOOTER_RE =
    /window\.__SUPER_NOTEPAD_COMPOSER_FOOTER__\s*=\s*(\{[\s\S]*?\})\s*;/;

  return {
    name: "supernotepad:dev-session-token",
    apply: "serve",
    async transformIndexHtml() {
      try {
        const res = await fetch(BACKEND, { headers: { accept: "text/html" } });
        const html = await res.text();
        const match = html.match(TOKEN_RE);
        if (!match) {
          console.warn(
            `[super-notepad] Could not find session token in ${BACKEND} — ` +
              `is \`python -m super_notepad\` running? /api calls will 401.`,
          );
          return;
        }
        let footerJs = "";
        const footerMatch = html.match(FOOTER_RE);
        if (footerMatch) {
          footerJs = `window.__SUPER_NOTEPAD_COMPOSER_FOOTER__=${footerMatch[1]};`;
        } else {
          try {
            const [statusRes, modelRes] = await Promise.all([
              fetch(`${BACKEND}/api/status`, {
                headers: { accept: "application/json" },
              }),
              fetch(`${BACKEND}/api/model/info`, {
                headers: { accept: "application/json" },
              }),
            ]);
            const status = statusRes.ok
              ? ((await statusRes.json()) as {
                  cwd?: string;
                  cwd_label?: string;
                  model?: string;
                  model_label?: string;
                  provider?: string;
                })
              : {};
            const model = modelRes.ok
              ? ((await modelRes.json()) as {
                  model?: string;
                  model_label?: string;
                  provider?: string;
                  cwd?: string;
                  cwd_label?: string;
                })
              : {};
            const payload = {
              model: model.model ?? status.model ?? "",
              model_label: model.model_label ?? status.model_label ?? "",
              provider: model.provider ?? status.provider ?? "",
              cwd: status.cwd ?? model.cwd ?? "",
              cwd_label: status.cwd_label ?? model.cwd_label ?? "",
            };
            footerJs = `window.__SUPER_NOTEPAD_COMPOSER_FOOTER__=${JSON.stringify(payload)};`;
          } catch {
            /* footer opcional em dev */
          }
        }

        return [
          {
            tag: "script",
            injectTo: "head",
            children:
              `window.__SUPER_NOTEPAD_SESSION_TOKEN__="${match[1]}";` +
              footerJs,
          },
        ];
      } catch (err) {
        console.warn(
          `[super-notepad] Dashboard at ${BACKEND} unreachable — ` +
            `start it with \`python -m super_notepad\` or set SUPER_NOTEPAD_DASHBOARD_URL. ` +
            `(${(err as Error).message})`,
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), superNotepadDevToken()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@sn/theme-tokens": path.resolve(
        __dirname,
        "./src/themes/themeTokens.ts",
      ),
    },
  },
  build: {
    outDir: "../../backend/super_notepad/web_dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // NÃO agrupar o mermaid num chunk manual: forçar isso fazia o Rollup
          // emitir também um import ESTÁTICO do chunk a partir do entry (além do
          // import() dinâmico do MermaidBlock), puxando ~2.7 MB no BOOT. Deixado
          // ao code-splitting automático, o `import("mermaid")` vira um chunk
          // async carregado só quando um diagrama é renderizado.
          if (/[/\\]recharts[/\\]/.test(id)) {
            return "charts-vendor";
          }
          if (
            /[/\\](?:react-markdown|remark-|rehype-|unified|micromark|mdast-|lowlight|highlight\.js|hast-|unist-|vfile)[/\\]/.test(
              id,
            )
          ) {
            return "markdown-vendor";
          }
          return undefined;
        },
      },
    },
    modulePreload: {
      // Não pré-carregar o chunk do mermaid no boot: ele é pesado (~2.7 MB) e só
      // serve para renderizar um diagrama (raro). Mesmo como chunk async, o Vite
      // injetaria um <link rel="modulepreload"> por ele ser alcançável do grafo
      // inicial; removê-lo dos hints devolve o carregamento sob demanda, na 1ª
      // renderização. Filtra por "mermaid" (o nome do chunk é automático agora).
      resolveDependencies: (_file, deps) =>
        deps.filter((dep) => !/mermaid/i.test(dep)),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: BACKEND,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
