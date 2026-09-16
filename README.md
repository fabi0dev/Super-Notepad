# Super-Notepad

App de notas desktop: editor rico, pastas, favoritos, cadeado, histórico de
versões, anexos e exportação PDF/HTML/TXT, usando **SQLite** como banco.

Stack: shell **Tauri** (janela nativa) + backend **Python/FastAPI** + frontend
**React/Vite/TipTap**, autocontido e com dados num banco dedicado.

## Arquitetura

```
super-notepad/
├── backend/                     # Python (FastAPI + SQLite)
│   ├── super_notepad/
│   │   ├── notes_store.py        # cofre de notas em SQLite (notes.db)
│   │   ├── note_attachments.py   # anexos (blobs + índice)
│   │   ├── note_links.py         # vínculos entre notas (wikilinks)
│   │   ├── app_db.py             # motor SQLite (WAL, escrita atômica)
│   │   ├── dashboard_auth.py     # token de sessão + cookie de acesso
│   │   ├── routes/notes.py       # API REST /api/notes
│   │   ├── web_server.py         # servidor FastAPI (SPA + auth)
│   │   └── __main__.py           # python -m super_notepad
│   └── pyproject.toml
├── frontend/dashboard/          # React + Vite + TipTap
│   └── src/
│       ├── pages/NotesPage/      # o app de notas em si
│       ├── App.tsx / main.tsx    # entry (monta só a NotesPage)
│       └── ...                   # design system, temas, api client
└── desktop/                     # shell Tauri (janela nativa)
```

### Onde ficam os dados

Tudo em `~/.super-notepad` (sobrescreva com a variável `SUPER_NOTEPAD_HOME`):

- `~/.super-notepad/notes.db` — banco SQLite (notas, pastas, histórico de versões).
- `~/.super-notepad/notes/.attachments/` — anexos (imagens/arquivos das notas).
- `~/.super-notepad/dashboard/auth_secret.key` — segredo que assina os tokens.

## Como rodar

### 1. Backend

```bash
cd backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m super_notepad --port 9010
```

Isso sobe o servidor em `http://127.0.0.1:9010` e abre o navegador com um token
de acesso. O backend serve o frontend já compilado de `super_notepad/web_dist/`.

### 2. Frontend

Para gerar o bundle que o backend serve:

```bash
cd frontend/dashboard
pnpm install
pnpm build            # escreve em ../../backend/super_notepad/web_dist
```

Para desenvolver o frontend com hot-reload (com o backend rodando em paralelo):

```bash
cd frontend/dashboard
pnpm dev              # http://localhost:5173 (proxy /api → 9010)
```

### 3. App do sistema (macOS)

No macOS, o `./install.sh` já compila o app Tauri e instala **"Super Notepad.app"**
em `/Applications` — ele aparece no Launchpad e no Finder. Ao abrir, o app sobe o
backend Python (usando o `~/.super-notepad/desktop.json` que o install escreveu,
apontando para o venv e o `backend/` deste repositório) e mostra a janela nativa.

Para pular esse passo: `./install.sh --no-app`.

> Como o app não embute o Python, ele depende do venv/`backend/` deste repo nos
> caminhos gravados em `desktop.json`. Se mover o repositório, rode `./install.sh`
> de novo. Um bundle 100% autônomo (com Python embutido) é trabalho futuro.

Para desenvolver o shell nativo com hot-reload:

```bash
cd desktop && pnpm install
SUPER_NOTEPAD_PYTHON=../backend/.venv/bin/python \
SUPER_NOTEPAD_BACKEND_DIR=../backend \
pnpm tauri dev
```

## Notas de arquitetura

- **Banco dedicado**: os dados vivem em `~/.super-notepad/notes.db`. O motor
  SQLite (`app_db.py`) usa WAL + escrita atômica.
- **Entry enxuto**: `App.tsx`/`main.tsx` montam apenas a `NotesPage`; os
  utilitários compartilhados (design system, temas, `api.ts`) ficam em
  `src/components`, `src/lib` e `src/themes`.
- **Sem agente/LLM**: o app é 100% local — não há chamadas a modelos de
  linguagem nem dependência de rede para as funcionalidades de notas.
