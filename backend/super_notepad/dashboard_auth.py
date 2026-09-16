import base64
import hmac
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from uuid import uuid4

from super_notepad.constants import get_super_notepad_home


_AUTH_DIR_NAME = "dashboard"
_AUTH_SECRET_FILE = "auth_secret.key"


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * ((4 - (len(s) % 4)) % 4)
    return base64.urlsafe_b64decode((s + pad).encode("ascii"))


def _get_secret_path() -> Path:
    return get_super_notepad_home() / _AUTH_DIR_NAME / _AUTH_SECRET_FILE


def _read_or_create_secret() -> bytes:
    path = _get_secret_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        data = path.read_bytes()
        if len(data) >= 32:
            return data
    data = os.urandom(32)
    path.write_bytes(data)
    try:
        os.chmod(path, 0o600)
    except Exception:
        # Best-effort (Windows / restricted FS).
        pass
    return data


@dataclass(frozen=True)
class DashboardTokenPayload:
    exp: int
    nonce: str
    v: int = 1

    def to_dict(self) -> Dict[str, Any]:
        return {"v": self.v, "exp": self.exp, "nonce": self.nonce}


def create_dashboard_access_token(*, ttl_seconds: int) -> str:
    ttl = int(ttl_seconds)
    if ttl <= 0 or ttl > 60 * 60 * 24 * 30:
        raise ValueError("ttl_seconds must be within (0, 30 days]")

    secret = _read_or_create_secret()
    payload = DashboardTokenPayload(
        exp=int(time.time()) + ttl,
        nonce=str(uuid4()),
    )
    payload_bytes = json.dumps(payload.to_dict(), separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(payload_bytes)
    sig = hmac.new(secret, payload_b64.encode("ascii"), digestmod="sha256").digest()
    sig_b64 = _b64url_encode(sig)
    return f"{payload_b64}.{sig_b64}"


def verify_dashboard_access_token(token: str) -> Tuple[bool, Optional[DashboardTokenPayload]]:
    t = (token or "").strip()
    if not t or "." not in t:
        return False, None
    try:
        payload_b64, sig_b64 = t.split(".", 1)
        secret = _read_or_create_secret()
        expected_sig = hmac.new(secret, payload_b64.encode("ascii"), digestmod="sha256").digest()
        if not hmac.compare_digest(_b64url_encode(expected_sig), sig_b64):
            return False, None
        payload_raw = _b64url_decode(payload_b64)
        parsed: Any = json.loads(payload_raw.decode("utf-8"))
        if not isinstance(parsed, dict):
            return False, None
        v = int(parsed.get("v", 0))
        exp = int(parsed.get("exp", 0))
        nonce = str(parsed.get("nonce", "")).strip()
        if v != 1 or not nonce:
            return False, None
        if exp <= int(time.time()):
            return False, None
        return True, DashboardTokenPayload(v=v, exp=exp, nonce=nonce)
    except Exception:
        return False, None


# ---------------------------------------------------------------------------
# Token de sessão do painel
# ---------------------------------------------------------------------------
# O painel o recebe na abertura (injetado no HTML) e o reenvia no header
# dedicado. Mora aqui (junto da auth por cookie) para os routers e o web_server
# compartilharem a validação sem depender um do outro. As anotações de
# ``Request`` ficam soltas e o ``HTTPException`` é importado lazy para este
# módulo de auth não ganhar uma dependência de import do FastAPI.
#
# DERIVADO do secret persistente (o mesmo arquivo 0600 que assina o cookie), e
# NÃO aleatório por processo: assim o token é ESTÁVEL entre reinícios do
# servidor. Antes (``secrets.token_urlsafe``) todo restart trocava o token e as
# janelas JÁ abertas (Notas, Finanças…) passavam a dar 401 → "sessão expirou,
# recarregue a página". Só quem já lê o secret (a própria conta do usuário)
# conseguiria reproduzir o token, então a estabilidade não enfraquece o modelo.

_SESSION_TOKEN = _b64url_encode(
    hmac.new(
        _read_or_create_secret(),
        b"super-notepad-session-token/v1",
        digestmod="sha256",
    ).digest()
)
_SESSION_HEADER_NAME = "X-Super-Notepad-Session-Token"


def _has_valid_session_token(request) -> bool:
    """True if the request carries a valid dashboard session token.

    The dedicated session header avoids collisions with reverse proxies that
    already use ``Authorization`` (for example Caddy ``basic_auth``). We still
    accept the legacy Bearer path for backward compatibility with older
    dashboard bundles.
    """
    session_header = request.headers.get(_SESSION_HEADER_NAME, "")
    if session_header and hmac.compare_digest(
        session_header.encode(),
        _SESSION_TOKEN.encode(),
    ):
        return True

    auth = request.headers.get("authorization", "")
    expected = f"Bearer {_SESSION_TOKEN}"
    return hmac.compare_digest(auth.encode(), expected.encode())


def _require_token(request) -> None:
    """Validate the ephemeral session token.  Raises 401 on mismatch."""
    from fastapi import HTTPException

    if not _has_valid_session_token(request):
        raise HTTPException(status_code=401, detail="Não autorizado")

