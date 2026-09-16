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

No macOS, o `./install.sh` já compila o app Tauri e instala **"Super Note.app"**
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

### 4. App do sistema (Windows)

No Windows, o `install.ps1` (espelho do `install.sh`) faz tudo — e, numa máquina
limpa, **instala sozinho as dependências que faltarem via [winget](https://learn.microsoft.com/windows/package-manager/):**
Python, Node.js (pnpm), Rust, o **MSVC C++ Build Tools** e o **WebView2 Runtime**
(o Tauri precisa dos dois últimos no Windows). Depois cria o venv, compila o
frontend, escreve o `desktop.json`, instala o atalho e gera o instalador NSIS.

No PowerShell, a partir da raiz do repo:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
# .\install.ps1 -NoApp        → só o backend/frontend (não instala Rust/Build Tools)
# .\install.ps1 -NoBootstrap  → não instala nada automaticamente, apenas verifica
```

Requisitos: Windows 10 (1809+) ou 11 com o **winget** (App Installer da Microsoft
Store). A instalação do MSVC C++ Build Tools e do WebView2 pode abrir um prompt de
**UAC (elevação)** — aceite-o. Se o script instalou algo novo (Node, Rust, Build
Tools), **abra um novo terminal** antes de usar esses comandos numa próxima sessão:
o `PATH` só é atualizado em janelas novas.

Os passos manuais equivalentes estão abaixo. Os dados ficam em
`%USERPROFILE%\.super-notepad` (espelhando o `Path.home()` do Python), e o venv
fica em `.venv\Scripts\` em vez de `.venv/bin/`.

Backend (PowerShell), a partir de `backend\`:

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m super_notepad --port 9010
```

Shell nativo em dev (hot-reload), a partir de `desktop\`:

```powershell
pnpm install
$env:SUPER_NOTEPAD_PYTHON="..\backend\.venv\Scripts\python.exe"
$env:SUPER_NOTEPAD_BACKEND_DIR="..\backend"
pnpm tauri dev
```

Instalador nativo (`.exe` NSIS), a partir de `desktop\`:

```powershell
cd ..\frontend\dashboard; pnpm build   # gera o web_dist que o backend serve
cd ..\..\desktop; pnpm tauri build --bundles nsis
```

O `--bundles nsis` sobrepõe o alvo `app` (que é bundle do macOS) do
`tauri.conf.json`. Como no macOS, o app não embute o Python: aponte o venv e o
`backend\` no `%USERPROFILE%\.super-notepad\desktop.json` (veja
`desktop/desktop.json.example`, usando caminhos com `\` e `.venv\Scripts\python.exe`).

## Notas de arquitetura

- **Banco dedicado**: os dados vivem em `~/.super-notepad/notes.db`. O motor
  SQLite (`app_db.py`) usa WAL + escrita atômica.
- **Entry enxuto**: `App.tsx`/`main.tsx` montam apenas a `NotesPage`; os
  utilitários compartilhados (design system, temas, `api.ts`) ficam em
  `src/components`, `src/lib` e `src/themes`.
- **Sem agente/LLM**: o app é 100% local — não há chamadas a modelos de
  linguagem nem dependência de rede para as funcionalidades de notas.
