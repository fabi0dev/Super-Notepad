"""Servidor web do app de Super-Notepad.

Serve o SPA (frontend React buildado em ``web_dist/``) e as rotas ``/api/notes``
e ``/api/note-links``. Mesma arquitetura de autenticação do painel do Super Note —
duas camadas derivadas de um segredo HMAC persistente (``~/.super-notepad/dashboard/``):

1. **Cookie de acesso** — a URL é aberta uma vez com ``?token=...`` (gerado no
   arranque); se válido, grava um cookie HttpOnly e redireciona sem o token.
2. **Token de sessão** — todo ``/api/*`` exige o header ``X-Super-Notepad-Session-Token``
   (injetado no ``index.html``). Exceção: ``GET /api/notes/attachments/...``, que
   uma tag ``<img>``/``<video>`` não consegue mandar com header — aí o cookie basta.

Loopback por padrão (porta 9010). Sem dependência do agente.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.parse
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
)
from fastapi.staticfiles import StaticFiles

from super_notepad import __version__
from super_notepad.dashboard_auth import (
    _SESSION_TOKEN,
    _has_valid_session_token,
    create_dashboard_access_token,
    verify_dashboard_access_token,
)
from super_notepad.routes import note_links as _routes_note_links
from super_notepad.routes import notes as _routes_notes

_log = logging.getLogger(__name__)

WEB_DIST = (
    Path(os.environ["SUPER_NOTEPAD_WEB_DIST"])
    if "SUPER_NOTEPAD_WEB_DIST" in os.environ
    else Path(__file__).parent / "web_dist"
)

app = FastAPI(title="Super-Notepad", version=__version__)
app.include_router(_routes_notes.router)
app.include_router(_routes_note_links.router)

# CORS: só origens locais (o app roda em loopback). Necessário para o `vite dev`
# em localhost:5173 falar com o backend.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Autenticação ─────────────────────────────────────────────────────────────

_DASH_AUTH_COOKIE_NAME = "super_notepad_dash_auth"
_DASH_AUTH_QUERY_PARAM = "token"
_DASH_AUTH_COOKIE_TTL = 60 * 60 * 24 * 7  # 7 dias

# Endpoints que dispensam o token de sessão. Mínimo possível.
_PUBLIC_API_PATHS: frozenset = frozenset({"/api/auth/logout"})

_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def _parse_bool_env(name: str, default: bool) -> bool:
    raw = str(os.environ.get(name, "")).strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


def _extract_cookie_token(cookie_header: str, name: str) -> str:
    if not cookie_header:
        return ""
    needle = f"{name}="
    for part in cookie_header.split(";"):
        p = part.strip()
        if p.startswith(needle):
            return p[len(needle):].strip()
    return ""


def _has_valid_dashboard_auth_cookie(request: Request) -> bool:
    raw = _extract_cookie_token(request.headers.get("cookie", ""), _DASH_AUTH_COOKIE_NAME)
    ok, _ = verify_dashboard_access_token(raw)
    return bool(ok)


@app.middleware("http")
async def dashboard_access_middleware(request: Request, call_next):
    """Porteiro: todo o app fica atrás de um cookie de acesso assinado.

    Abra a URL com ``?token=...`` uma vez → vira cookie HttpOnly + redirect.
    Desliga com ``SUPER_NOTEPAD_DASHBOARD_AUTH=0``.
    """
    if not _parse_bool_env("SUPER_NOTEPAD_DASHBOARD_AUTH", True):
        return await call_next(request)

    if request.url.path in _PUBLIC_API_PATHS:
        return await call_next(request)

    if _has_valid_dashboard_auth_cookie(request):
        return await call_next(request)

    token = request.query_params.get(_DASH_AUTH_QUERY_PARAM, "")
    ok, _payload = verify_dashboard_access_token(token)
    if not ok:
        if request.url.path.startswith("/api/"):
            return JSONResponse(status_code=401, content={"detail": "Não autorizado"})
        return HTMLResponse(
            status_code=401,
            content="<h1>Acesso não autorizado</h1><p>Abra o app pelo atalho "
            "(a URL precisa do token de acesso).</p>",
        )

    # Troca o token da URL por um cookie e redireciona sem vazar o token.
    clean_url = str(request.url).split("?", 1)[0]
    qs = [
        (k, v)
        for (k, v) in request.query_params.multi_items()
        if k != _DASH_AUTH_QUERY_PARAM
    ]
    if qs:
        clean_url = f"{clean_url}?{urllib.parse.urlencode(qs)}"
    response = RedirectResponse(url=clean_url, status_code=307)
    response.set_cookie(
        key=_DASH_AUTH_COOKIE_NAME,
        value=create_dashboard_access_token(ttl_seconds=_DASH_AUTH_COOKIE_TTL),
        httponly=True,
        samesite="lax",
        max_age=_DASH_AUTH_COOKIE_TTL,
        path="/",
    )
    return response


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Exige o token de sessão em todo ``/api/`` (menos a lista pública)."""
    path = request.url.path
    if path.startswith("/api/") and path not in _PUBLIC_API_PATHS:
        if not _has_valid_session_token(request):
            # Mídia servida a <img>/<video>/<a> não manda header — o cookie
            # (já validado pelo porteiro acima) basta para o GET do anexo.
            if (
                request.method == "GET"
                and path.startswith("/api/notes/attachments/")
                and _has_valid_dashboard_auth_cookie(request)
            ):
                return await call_next(request)
            return JSONResponse(status_code=401, content={"detail": "Não autorizado"})
    return await call_next(request)


@app.post("/api/auth/logout")
async def logout() -> JSONResponse:
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(key=_DASH_AUTH_COOKIE_NAME, path="/")
    return response


@app.get("/api/config")
async def get_config() -> JSONResponse:
    """Config mínima que o painel de Super-Notepad lê. O app standalone não tem o painel
    de configurações do Super Note — só o que o editor consulta (autocomplete off).
    Ponto de extensão: expor aqui as preferências de um futuro app."""
    return JSONResponse(
        {"dashboard": {"notes": {"autocomplete_enabled": False}}}
    )


# ── SPA (frontend buildado) ──────────────────────────────────────────────────


def mount_spa(application: FastAPI) -> None:
    """Monta o SPA; injeta o token de sessão no ``index.html``."""
    index_path = WEB_DIST / "index.html"
    if not WEB_DIST.exists() or not index_path.is_file():

        @application.get("/{full_path:path}")
        async def no_frontend(full_path: str):
            return JSONResponse(
                {
                    "error": "Frontend não compilado. Rode: "
                    "cd frontend/dashboard && pnpm install && pnpm build"
                },
                status_code=404,
            )

        return

    def _serve_index() -> HTMLResponse:
        html = index_path.read_text()
        token_script = (
            f'<script>window.__SUPER_NOTEPAD_SESSION_TOKEN__="{_SESSION_TOKEN}";'
            f"window.__SUPER_NOTEPAD_COMPOSER_FOOTER__={{}};</script>"
        )
        html = html.replace("</head>", f"{token_script}</head>", 1)
        return HTMLResponse(
            html, headers={"Cache-Control": "no-store, no-cache, must-revalidate"}
        )

    class _HashedAssets(StaticFiles):
        """Assets do Vite (nome com hash de conteúdo) → cacheáveis para sempre."""

        def file_response(self, *args, **kwargs):
            response = super().file_response(*args, **kwargs)
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response

    application.mount(
        "/assets", _HashedAssets(directory=WEB_DIST / "assets"), name="assets"
    )

    @application.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        # /api/* nunca cai no index (senão fetch(...).json() quebra no "<!doctype").
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse(
                status_code=404, content={"detail": "Rota API não encontrada"}
            )
        file_path = WEB_DIST / full_path
        if (
            full_path
            and file_path.resolve().is_relative_to(WEB_DIST.resolve())
            and file_path.is_file()
        ):
            return FileResponse(
                file_path, headers={"Cache-Control": "no-cache"}
            )
        return _serve_index()


mount_spa(app)


# ── Arranque ─────────────────────────────────────────────────────────────────


def start_server(
    host: str = "127.0.0.1",
    port: int = 9010,
    open_browser: bool = True,
    *,
    allow_public: bool = False,
) -> None:
    """Sobe o servidor (uvicorn)."""
    import threading
    import webbrowser

    import uvicorn

    if host not in _LOOPBACK_HOSTS and not allow_public:
        raise SystemExit(
            f"Recusando vincular a {host} — o app não tem autenticação robusta "
            "para redes. Use --insecure para forçar (não recomendado)."
        )

    require_auth = _parse_bool_env("SUPER_NOTEPAD_DASHBOARD_AUTH", True)
    display_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    primary_url = f"http://{display_host}:{port}"
    open_url = primary_url
    if require_auth:
        token = create_dashboard_access_token(ttl_seconds=3600)
        open_url = f"{primary_url}/?{_DASH_AUTH_QUERY_PARAM}={token}"

    # O shell desktop (Tauri) precisa da URL com token para apontar a webview.
    # Parsear o stdout é frágil (o Python bufferiza), então gravamos a URL num
    # arquivo que o app lê por polling. Ativado por SUPER_NOTEPAD_DESKTOP_URL_FILE.
    url_file = os.environ.get("SUPER_NOTEPAD_DESKTOP_URL_FILE", "").strip()
    if url_file:
        try:
            p = Path(url_file)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(open_url, encoding="utf-8")
        except OSError:
            _log.warning("não consegui gravar SUPER_NOTEPAD_DESKTOP_URL_FILE=%s", url_file)

    if open_browser:
        threading.Thread(
            target=lambda: webbrowser.open(open_url), daemon=True
        ).start()

    print(f"  Super-Notepad → {primary_url}", flush=True)
    if open_url != primary_url:
        print(f"  Super-Notepad (com token de acesso) → {open_url}", flush=True)

    uvicorn.run(app, host=host, port=port, log_level="warning")
