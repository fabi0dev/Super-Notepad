#!/usr/bin/env bash
# ============================================================================
# Super-Notepad — script de instalação
# ============================================================================
# Prepara o app para rodar a partir do repositório clonado:
#   1. Cria o venv do backend e instala as dependências Python
#   2. Compila o frontend (gera backend/super_notepad/web_dist)
#   3. Escreve ~/.super-notepad/desktop.json (para o shell Tauri achar o backend)
#   4. Instala um atalho `super-notepad` em ~/.local/bin
#   5. (macOS) Compila o app Tauri e instala "Super Notepad.app" em /Applications
#
# Uso:
#   ./install.sh                 # tudo (inclui o app do sistema no macOS)
#   ./install.sh --no-app        # não compila/instala o "Super Notepad.app"
#   ./install.sh --no-frontend   # pula o build do frontend
#   ./install.sh --no-launcher   # não cria o atalho em ~/.local/bin
#   ./install.sh --port 9010     # porta do backend (padrão 9010)
# ============================================================================

set -euo pipefail

# ── Cores ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; BRED='\033[1;31m'; GREEN='\033[0;32m'
YELLOW='\033[0;33m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

_bar() {
    local w line
    w=$(tput cols 2>/dev/null) || w=52
    [ -z "$w" ] || [ "$w" -lt 20 ] && w=52
    [ "$w" -gt 56 ] && w=56
    line=$(printf '─%.0s' $(seq 1 "$w"))
    echo -e "${DIM}${line}${NC}"
}
step() { echo -e "\n${BRED}▸${NC} ${BOLD}$1${NC}"; }
ok()   { echo -e "  ${GREEN}✔${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
die()  { echo -e "\n${RED}✖ $1${NC}\n" >&2; exit 1; }

# ── Args ─────────────────────────────────────────────────────────────────────
DO_FRONTEND=1
DO_LAUNCHER=1
DO_DESKTOP_CONFIG=1
PORT=9010
# App do sistema: por padrão só no macOS (o bundle .app). Fora do macOS, pular.
if [ "$(uname)" = "Darwin" ]; then DO_APP=1; else DO_APP=0; fi

while [ $# -gt 0 ]; do
    case "$1" in
        --no-frontend) DO_FRONTEND=0 ;;
        --no-launcher) DO_LAUNCHER=0 ;;
        --no-desktop-config) DO_DESKTOP_CONFIG=0 ;;
        --no-app) DO_APP=0 ;;
        --app) DO_APP=1 ;;
        --port) shift; PORT="${1:-9010}" ;;
        -h|--help)
            sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) die "Argumento desconhecido: $1" ;;
    esac
    shift
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
DASHBOARD="$ROOT/frontend/dashboard"
SUPER_NOTEPAD_HOME="${SUPER_NOTEPAD_HOME:-$HOME/.super-notepad}"

_bar
echo -e "${BOLD}  Instalando o app Super-Notepad${NC}"
echo -e "${DIM}  $ROOT${NC}"
_bar

# ── Pré-requisitos ───────────────────────────────────────────────────────────
step "Verificando pré-requisitos"
command -v python3 >/dev/null 2>&1 || die "python3 não encontrado. Instale o Python 3.10+."
PY_VER="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
ok "python3 $PY_VER"

if [ "$DO_FRONTEND" -eq 1 ] || [ "$DO_APP" -eq 1 ]; then
    if command -v pnpm >/dev/null 2>&1; then
        ok "pnpm $(pnpm --version)"
    elif command -v corepack >/dev/null 2>&1; then
        warn "pnpm ausente — habilitando via corepack"
        corepack enable >/dev/null 2>&1 || true
        command -v pnpm >/dev/null 2>&1 || die "Não consegui habilitar o pnpm. Instale-o: npm i -g pnpm"
        ok "pnpm $(pnpm --version)"
    else
        die "pnpm não encontrado (necessário para compilar o frontend/app). Instale-o ou rode com --no-frontend --no-app."
    fi
fi

if [ "$DO_APP" -eq 1 ]; then
    if command -v cargo >/dev/null 2>&1; then
        ok "cargo $(cargo --version | awk '{print $2}')"
    else
        warn "cargo (Rust) não encontrado — pulando o app do sistema. Instale via https://rustup.rs e rode de novo, ou use --no-app."
        DO_APP=0
    fi
fi

# ── Backend ──────────────────────────────────────────────────────────────────
step "Backend (Python + SQLite)"
if [ ! -x "$BACKEND/.venv/bin/python" ]; then
    python3 -m venv "$BACKEND/.venv"
    ok "venv criado em backend/.venv"
else
    ok "venv já existe"
fi
"$BACKEND/.venv/bin/pip" install -q --upgrade pip
"$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt"
ok "dependências instaladas"

# ── Frontend ─────────────────────────────────────────────────────────────────
if [ "$DO_FRONTEND" -eq 1 ]; then
    step "Frontend (React + Vite)"
    ( cd "$DASHBOARD" && pnpm install --silent )
    ok "dependências instaladas"
    ( cd "$DASHBOARD" && pnpm build )
    ok "build gerado em backend/super_notepad/web_dist"
else
    warn "Frontend pulado (--no-frontend). O backend precisa do build para servir a UI."
fi

# ── Config do desktop (Tauri) ────────────────────────────────────────────────
if [ "$DO_DESKTOP_CONFIG" -eq 1 ]; then
    step "Configuração do desktop (Tauri)"
    mkdir -p "$SUPER_NOTEPAD_HOME"
    cat > "$SUPER_NOTEPAD_HOME/desktop.json" <<JSON
{
  "python": "$BACKEND/.venv/bin/python",
  "backend_dir": "$BACKEND",
  "port": $PORT,
  "keep_panel": false
}
JSON
    ok "escrito $SUPER_NOTEPAD_HOME/desktop.json"
fi

# ── Atalho `super-notepad` ───────────────────────────────────────────────────────────
if [ "$DO_LAUNCHER" -eq 1 ]; then
    step "Atalho de linha de comando"
    BIN_DIR="$HOME/.local/bin"
    mkdir -p "$BIN_DIR"
    LAUNCHER="$BIN_DIR/super-notepad"
    cat > "$LAUNCHER" <<SH
#!/usr/bin/env bash
# Sobe o backend do app Super-Notepad (gerado por install.sh).
cd "$BACKEND"
exec "$BACKEND/.venv/bin/python" -m super_notepad --port $PORT "\$@"
SH
    chmod +x "$LAUNCHER"
    ok "instalado $LAUNCHER"
    case ":$PATH:" in
        *":$BIN_DIR:"*) : ;;
        *) warn "$BIN_DIR não está no PATH — adicione: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
    esac
fi

# ── App do sistema (macOS: "Super Notepad.app" em /Applications) ──────────────
APP_INSTALLED=0
if [ "$DO_APP" -eq 1 ]; then
    step "App do sistema (Tauri → /Applications)"
    if [ ! -f "$BACKEND/super_notepad/web_dist/index.html" ]; then
        warn "web_dist ausente (rode sem --no-frontend). O app precisa do frontend compilado; pulando."
    else
        ( cd "$ROOT/desktop" && pnpm install --silent )
        echo -e "  ${DIM}compilando o app em modo release — pode levar alguns minutos…${NC}"
        ( cd "$ROOT/desktop" && pnpm tauri build )
        APP_SRC="$ROOT/desktop/src-tauri/target/release/bundle/macos/Super Notepad.app"
        if [ -d "$APP_SRC" ]; then
            rm -rf "/Applications/Super Notepad.app"
            cp -R "$APP_SRC" "/Applications/"
            # Um cp -R não avisa o macOS. Registrar no LaunchServices é o que faz
            # o app aparecer no Launchpad e no "Abrir com"; o mdimport é o que o
            # coloca no índice do Spotlight (a busca por apps depende dos dois).
            APP_DST="/Applications/Super Notepad.app"
            # 1) touch primeiro: marca o bundle como recém-modificado para que o
            #    Spotlight não o considere "atualizado" e pule a indexação.
            /usr/bin/touch "$APP_DST"
            # 2) registra no LaunchServices (Launchpad / "Abrir com").
            LSREG="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
            [ -x "$LSREG" ] && "$LSREG" -f "$APP_DST" >/dev/null 2>&1 || true
            # 3) mdimport -i: força a indexação no Spotlight AGORA, mesmo que o
            #    bundle pareça já indexado. Sem o -i, um cp -R recém-feito costuma
            #    ser ignorado e o app não aparece na busca.
            /usr/bin/mdimport -i "$APP_DST" >/dev/null 2>&1 || true
            # Obs.: não usamos "defaults write com.apple.dock ResetLaunchPad" +
            # "killall Dock" de propósito — aquilo apaga a organização do Launchpad
            # do usuário. O lsregister acima já basta para o app aparecer.
            ok "instalado em /Applications/Super Notepad.app (registrado no Launchpad e no Spotlight)"
            APP_INSTALLED=1
        else
            warn "bundle não encontrado em: $APP_SRC"
        fi
    fi
fi

# ── Resumo ───────────────────────────────────────────────────────────────────
echo
_bar
echo -e "${GREEN}${BOLD}  Pronto!${NC}"
_bar
if [ "$APP_INSTALLED" -eq 1 ]; then
    echo -e "  ${BOLD}Super Notepad${NC} instalado — abra pelo Launchpad ou em ${BOLD}/Applications${NC}."
fi
echo -e "  Iniciar pelo terminal:"
if [ "$DO_LAUNCHER" -eq 1 ]; then
    echo -e "    ${BOLD}super-notepad${NC}                        ${DIM}# abre em http://127.0.0.1:$PORT${NC}"
fi
echo -e "    ${BOLD}backend/.venv/bin/python -m super_notepad --port $PORT${NC}"
echo -e "  App desktop (Tauri, modo dev):"
echo -e "    ${BOLD}cd desktop && pnpm install && pnpm tauri dev${NC}"
echo -e "  Dados em: ${BOLD}$SUPER_NOTEPAD_HOME${NC}  ${DIM}(notes.db)${NC}"
echo
