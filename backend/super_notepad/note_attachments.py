"""Anexos de notas — imagens e arquivos embutidos no corpo markdown.

Cada anexo guarda o blob em ``<super_notepad_home>/notes/.attachments/<id><ext>`` e a
metadata (nome original, mime, tamanho) num índice JSON ao lado. A nota referencia
o anexo pela URL ``/api/notes/attachments/<id>`` dentro do próprio markdown
(``![](url)`` para imagem, ``[nome](url)`` para os demais), então o vínculo
sobrevive ao round-trip do editor e o agente, que lê markdown, enxerga a referência.

Espelha o padrão de ``recordings_store``: blob em disco + índice em JSON, servido
por ``routes/notes.py`` com ``Response(content=path.read_bytes(), ...)``.
"""

from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from super_notepad import json_store
from super_notepad.notes_store import notes_dir

# Teto por arquivo — evita encher o disco com um upload gigante acidental.
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024  # 25 MB

# Extensão → mime, para servir com o Content-Type certo. O que não estiver aqui
# cai em application/octet-stream (o browser oferece download).
_MIME_BY_EXT: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".json": "application/json",
    ".xml": "application/xml",
    ".yaml": "application/x-yaml",
    ".yml": "application/x-yaml",
    ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
}

_IMAGE_MIMES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/bmp",
    "image/x-icon",
}

_VIDEO_MIMES = {
    "video/mp4",
    "video/quicktime",
    "video/webm",
}

# ID: att_<ms em hex>_<uuid6>. Espelha o formato das notas (note_...), fácil de
# reconhecer e ordenável no tempo pela primeira metade.
_ID_RE = __import__("re").compile(r"^att_[0-9a-f]+_[0-9a-f]{6}$")


def attachments_dir() -> Path:
    d = notes_dir() / ".attachments"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path() -> Path:
    return attachments_dir() / "index.json"


def _load() -> dict[str, Any]:
    data = json_store.load_json(_index_path(), {"attachments": {}})
    if not isinstance(data.get("attachments"), dict):
        data["attachments"] = {}
    return data


def _mutate(fn):
    return json_store.mutate(_index_path(), _load, fn)


def _new_id() -> str:
    return f"att_{int(time.time() * 1000):x}_{uuid.uuid4().hex[:6]}"


def _clean_ext(filename: str, mime: str) -> str:
    """Extensão canônica a partir do nome; cai no mime se o nome não tiver uma."""
    ext = Path(filename or "").suffix.lower()
    if ext and len(ext) <= 12 and ext.replace(".", "").isalnum():
        return ext
    # Sem extensão no nome: deriva do mime pelos que conhecemos.
    for e, m in _MIME_BY_EXT.items():
        if m.split(";")[0] == (mime or "").split(";")[0]:
            return e
    return ".bin"


def mime_for(path: Path, fallback: str = "application/octet-stream") -> str:
    return _MIME_BY_EXT.get(path.suffix.lower(), fallback)


def is_image_mime(mime: str) -> bool:
    return (mime or "").split(";")[0].strip().lower() in _IMAGE_MIMES


def is_video_mime(mime: str) -> bool:
    return (mime or "").split(";")[0].strip().lower() in _VIDEO_MIMES


def _kind_for(mime: str) -> str:
    if is_image_mime(mime):
        return "image"
    if is_video_mime(mime):
        return "video"
    return "file"


def _public(rec: dict[str, Any]) -> dict[str, Any]:
    att_id = rec.get("id", "")
    mime = rec.get("mime") or "application/octet-stream"
    return {
        "id": att_id,
        "filename": rec.get("filename") or "arquivo",
        "mime": mime,
        "bytes": int(rec.get("bytes") or 0),
        "created_at": rec.get("created_at", 0),
        "kind": _kind_for(mime),
        "url": f"/api/notes/attachments/{att_id}",
    }


def save_attachment(*, filename: str, data: bytes, mime: str = "") -> dict[str, Any]:
    """Grava o blob e registra a metadata. Devolve a forma pública (com ``url``)."""
    if not data:
        raise ValueError("Arquivo vazio.")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ValueError(
            f"Arquivo grande demais (máx {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB)."
        )
    att_id = _new_id()
    ext = _clean_ext(filename, mime)
    fname = f"{att_id}{ext}"
    path = attachments_dir() / fname
    # Escrita atômica: tmp no mesmo dir + replace, para o servidor nunca ler meio blob.
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)

    clean_name = (filename or "").strip() or f"arquivo{ext}"
    resolved_mime = (mime or "").strip() or mime_for(path)
    rec = {
        "id": att_id,
        "file": fname,
        "filename": clean_name[:255],
        "mime": resolved_mime,
        "bytes": len(data),
        "created_at": time.time(),
    }

    def _apply(d: dict[str, Any]) -> dict[str, Any]:
        d.setdefault("attachments", {})[att_id] = rec
        return d

    _mutate(_apply)
    return _public(rec)


def _raw(att_id: str) -> Optional[dict[str, Any]]:
    if not _ID_RE.match(att_id or ""):
        return None
    return _load().get("attachments", {}).get(att_id)


def attachment_path(att_id: str) -> Optional[Path]:
    rec = _raw(att_id)
    if not rec:
        return None
    fname = rec.get("file")
    if not fname:
        return None
    p = attachments_dir() / fname
    return p if p.exists() else None


# IDs de anexo citados num texto — na URL `/api/notes/attachments/<id>` ou soltos.
# Usado pela coleta de lixo: uma nota que some deixa seus anexos órfãos.
_ATT_ID_RE = __import__("re").compile(r"att_[0-9a-f]+_[0-9a-f]{6}")


def extract_ids(text: str) -> set[str]:
    """Conjunto de IDs de anexo referenciados em `text` (corpo de nota)."""
    return set(_ATT_ID_RE.findall(text or ""))


def prune_unreferenced(referenced: set[str]) -> dict[str, int]:
    """Remove anexos que NENHUMA nota referencia (garbage collection).

    ``referenced`` = união dos IDs citados por todas as notas vivas. O que
    estiver no índice fora desse conjunto é órfão: apaga o arquivo e a metadata,
    liberando espaço. Preserva anexo ainda usado — inclusive compartilhado por
    duas notas. Best-effort e idempotente.
    """
    atts = _load().get("attachments", {})
    # Carência: o editor registra o anexo NA HORA do paste/drop, mas o corpo da
    # nota só persiste no autosave (debounce ~800ms) ou ao trocar de aba. Sem
    # janela, um GC (no start do app ou ao apagar QUALQUER outra nota) durante a
    # edição apagava o blob recém-enviado — a imagem da nota aberta virava 404.
    # Só coleta órfão com mais de GRACE de vida. (created_at ausente = legado,
    # já salvo → coletável.)
    _GRACE_SECONDS = 6 * 3600
    now = time.time()
    orphans = [
        aid
        for aid in list(atts.keys())
        if aid not in referenced
        and (now - float((atts.get(aid) or {}).get("created_at") or 0)) > _GRACE_SECONDS
    ]
    removed = 0
    freed = 0
    # Apaga os arquivos FORA da mutação do índice (que pode reexecutar em disputa).
    for aid in orphans:
        rec = atts.get(aid) or {}
        b = int(rec.get("bytes") or 0)
        fname = rec.get("file")
        if fname:
            p = attachments_dir() / fname
            try:
                if p.exists():
                    if not b:
                        b = p.stat().st_size
                    p.unlink()
            except OSError:
                pass
        removed += 1
        freed += b

    if orphans:

        def _apply(d: dict[str, Any]) -> dict[str, Any]:
            a = d.setdefault("attachments", {})
            for aid in orphans:
                a.pop(aid, None)
            return d

        _mutate(_apply)

    return {"removed": removed, "bytes_freed": freed}


def attachment_meta(att_id: str) -> Optional[dict[str, Any]]:
    rec = _raw(att_id)
    return _public(rec) if rec else None
