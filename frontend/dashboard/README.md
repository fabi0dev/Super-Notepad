# Super Note — Web UI

Frontend do app de notas: um único app React que ocupa a tela toda
(a `NotesPage`). O backend Python (`super_notepad`) serve este bundle já
compilado e as rotas `/api/notes`.

## Stack

- **Vite** + **React 19** + **TypeScript**
- **Tailwind CSS v4** com tema claro/escuro próprio
- **TipTap** como editor rico

## Desenvolvimento

```bash
# Terminal 1 — backend (API + SPA, porta padrão 9010)
cd ../../backend
./.venv/bin/python -m super_notepad --port 9010

# Terminal 2 — Vite HMR (faz proxy de /api → SUPER_NOTEPAD_DASHBOARD_URL ou http://127.0.0.1:9010)
cd frontend/dashboard
pnpm dev
```

## Build

```bash
pnpm run build
```

Escreve em `../../backend/super_notepad/web_dist/`, servido pelo backend.

## Estrutura

```
src/
├── components/       # primitivas de UI (ui/), AppLogo, Toast, ErrorBoundary
├── lib/              # api.ts, utils
├── themes/           # tokens de tema + ThemeProvider
├── pages/
│   └── NotesPage/    # o app de notas (editor, pastas, histórico, anexos)
└── App.tsx           # monta só a NotesPage em /notas
```

## Visual design

A paleta e os tokens semânticos vivem em
[`src/themes/themeTokens.ts`](src/themes/themeTokens.ts) (alias Vite
`@sn/theme-tokens`). `ThemeProvider` injeta `--surface`, `--border-color`, etc.

- Prefira **elevação por superfície** (`bg-(--surface)`, `bg-(--surface-hover)`)
  em vez de bordas.
- Use `--border-color` ou `--divider` para os poucos traços que restam
  (diálogos, inputs).
