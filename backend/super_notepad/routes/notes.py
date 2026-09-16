"""Notas — cofre de Markdown em ~/.super-notepad/notes (com pastas)."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel

router = APIRouter()


class NoteCreateBody(BaseModel):
    title: str = ""
    content: str = ""
    folder: str = ""


class NoteUpdateBody(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    folder: Optional[str] = None


class NoteFolderBody(BaseModel):
    path: str = ""


class NoteFolderRenameBody(BaseModel):
    old: str = ""
    new: str = ""


class NoteFolderContextBody(BaseModel):
    path: str = ""
    context: Optional[str] = None
    memory_tags: Optional[list[str]] = None


@router.get("/api/notes")
def notes_list():
    from super_notepad import notes_store

    return {
        "notes": notes_store.list_notes(),
        "folders": notes_store.list_folders(),
    }


@router.get("/api/notes/folders")
def notes_folders():
    from super_notepad import notes_store

    return {"folders": notes_store.list_folders()}


@router.post("/api/notes/folders")
def notes_folder_create(body: NoteFolderBody):
    from super_notepad import notes_store

    path = notes_store.create_folder(body.path)
    if path is None:
        raise HTTPException(status_code=400, detail="Nome de pasta inválido")
    return {"ok": True, "path": path, "folders": notes_store.list_folders()}


@router.put("/api/notes/folders")
def notes_folder_rename(body: NoteFolderRenameBody):
    from super_notepad import notes_store

    path = notes_store.rename_folder(body.old, body.new)
    if path is None:
        raise HTTPException(status_code=400, detail="Renomeação inválida")
    return {"ok": True, "path": path, "folders": notes_store.list_folders()}


@router.delete("/api/notes/folders")
def notes_folder_delete(path: str = ""):
    from super_notepad import notes_store

    notes_store.delete_folder(path)
    return {"ok": True, "folders": notes_store.list_folders()}


# ── Contexto por pasta (texto livre + tags de memória vinculadas) ────────────
# O agente injeta isto ao trabalhar com notas da pasta. Ver notes_store e
# tools/notes_tool.py.


@router.get("/api/notes/folders/context")
def notes_folder_context_get(path: str = ""):
    from super_notepad import notes_store

    return notes_store.get_folder_meta(path)


@router.put("/api/notes/folders/context")
def notes_folder_context_set(body: NoteFolderContextBody):
    from super_notepad import notes_store

    try:
        meta = notes_store.set_folder_meta(
            body.path, context=body.context, memory_tags=body.memory_tags
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, **meta}


@router.get("/api/notes/memory-tags")
def notes_memory_tags():
    """Tags de memória para vincular a uma pasta.

    O app de Notas standalone não tem sistema de memória de agente, então não
    há catálogo de tags — devolve lista vazia (o painel lida com isso).
    """
    return {"tags": []}


@router.get("/api/notes/search")
def notes_search(q: str = "", limit: int = 20):
    from super_notepad import notes_store

    return {"notes": notes_store.search_notes(q, max(1, min(limit, 100)))}


# --- Anexos -----------------------------------------------------------------
# Rotas literais declaradas ANTES de /api/notes/{note_id} para não caírem no
# path param. Auth herdada do middleware global do dashboard.


@router.post("/api/notes/attachments")
async def notes_attachment_upload(file: UploadFile = File(...)):
    from super_notepad import note_attachments

    data = await file.read()
    try:
        return note_attachments.save_attachment(
            filename=file.filename or "arquivo",
            data=data,
            mime=file.content_type or "",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/notes/attachments/{att_id}")
def notes_attachment_get(att_id: str, request: Request):
    from urllib.parse import quote

    from super_notepad import note_attachments

    path = note_attachments.attachment_path(att_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")
    meta = note_attachments.attachment_meta(att_id) or {}
    mime = meta.get("mime") or note_attachments.mime_for(path)
    headers = {
        "Cache-Control": "private, max-age=31536000, immutable",
        # Vídeo precisa de Range para tocar/buscar no WebKit; anunciamos o suporte.
        "Accept-Ranges": "bytes",
    }
    # Imagem rende inline no editor; os demais ganham nome amigável no download.
    if not note_attachments.is_image_mime(mime):
        fname = quote(str(meta.get("filename") or path.name))
        headers["Content-Disposition"] = f"inline; filename*=UTF-8''{fname}"

    data = path.read_bytes()
    total = len(data)

    # Requisição parcial (o <video> pede faixas de bytes): responde 206 com o
    # trecho pedido. Sem isto, o WebKit muitas vezes recusa tocar o vídeo.
    range_header = request.headers.get("range", "")
    if range_header.startswith("bytes="):
        spec = range_header.split("=", 1)[1].split(",", 1)[0].strip()
        start_s, _, end_s = spec.partition("-")
        try:
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else total - 1
        except ValueError:
            start, end = 0, total - 1
        end = min(end, total - 1)
        if 0 <= start <= end < total:
            headers["Content-Range"] = f"bytes {start}-{end}/{total}"
            return Response(
                content=data[start : end + 1],
                status_code=206,
                media_type=mime,
                headers=headers,
            )

    return Response(content=data, media_type=mime, headers=headers)


@router.get("/api/notes/{note_id}")
def notes_get(note_id: str):
    from super_notepad import notes_store

    note = notes_store.get_note(note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Nota não encontrada")
    return note


# ── Linha do tempo (histórico de versões) ───────────────────────────────────


@router.get("/api/notes/{note_id}/history")
def notes_history(note_id: str):
    """Versões da nota (mais recente primeiro): {ts, title, preview, chars}."""
    from super_notepad import notes_store

    if notes_store.get_note(note_id) is None:
        raise HTTPException(status_code=404, detail="Nota não encontrada")
    return {"versions": notes_store.list_versions(note_id)}


class NoteVersionBody(BaseModel):
    ts: str = ""


@router.post("/api/notes/{note_id}/history/version")
def notes_history_version(note_id: str, body: NoteVersionBody):
    """Conteúdo completo de uma versão (para pré-visualizar antes de restaurar)."""
    from super_notepad import notes_store

    version = notes_store.get_version(note_id, body.ts)
    if version is None:
        raise HTTPException(status_code=404, detail="Versão não encontrada")
    return version


@router.post("/api/notes/{note_id}/history/restore")
def notes_history_restore(note_id: str, body: NoteVersionBody):
    """Restaura a nota para uma versão anterior (vira a versão atual)."""
    from super_notepad import notes_store

    note = notes_store.restore_version(note_id, body.ts)
    if note is None:
        raise HTTPException(
            status_code=404, detail="Nota ou versão não encontrada"
        )
    return note


class NoteAutocompleteBody(BaseModel):
    note_id: str = ""
    prefix: str = ""
    suffix: str = ""
    context: str = ""


@router.post("/api/notes/autocomplete")
def notes_autocomplete(body: NoteAutocompleteBody):
    """Continuação em texto fantasma para o editor (estilo Cursor).

    Depende de um modelo de linguagem auxiliar, que não faz parte do app de
    Notas standalone — devolve sempre vazio (o editor simplesmente não sugere).
    Ponto de extensão: plugar aqui um cliente LLM para reativar a sugestão.
    """
    return {"completion": ""}


@router.post("/api/notes")
def notes_create(body: NoteCreateBody):
    from super_notepad import notes_store

    return notes_store.create_note(body.title, body.content, body.folder)


@router.put("/api/notes/{note_id}")
def notes_update(note_id: str, body: NoteUpdateBody):
    from super_notepad import notes_store

    note = notes_store.update_note(
        note_id, body.title, body.content, body.folder
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Nota não encontrada")
    return note


class NoteFavoriteBody(BaseModel):
    favorite: bool = True


class NoteExportBody(BaseModel):
    # Markdown atual (com edições ainda não salvas). Vazio = usa o do disco.
    content: str | None = None


@router.post("/api/notes/{note_id}/export/{fmt}")
def notes_export(note_id: str, fmt: str, body: NoteExportBody = NoteExportBody()):
    """Exporta a nota no servidor em ``fmt`` (pdf | html | txt)."""
    from urllib.parse import quote

    from fastapi import Response
    from super_notepad import notes_store

    fmt = (fmt or "").strip().lower()
    kinds = {
        "pdf": (notes_store.render_note_pdf, "application/pdf"),
        "html": (notes_store.render_note_html, "text/html; charset=utf-8"),
        "txt": (notes_store.render_note_text, "text/plain; charset=utf-8"),
    }
    if fmt not in kinds:
        raise HTTPException(status_code=400, detail="Formato inválido")
    render, media = kinds[fmt]
    try:
        out = render(note_id, body.content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha ao exportar: {exc}")
    if out is None:
        raise HTTPException(status_code=404, detail="Nota não encontrada")
    title, data = out
    payload = data if isinstance(data, bytes) else str(data).encode("utf-8")
    safe = (title or "nota").replace("/", "-").strip()[:80] or "nota"
    return Response(
        content=payload,
        media_type=media,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(safe)}.{fmt}"
        },
    )


@router.post("/api/notes/{note_id}/favorite")
def notes_favorite(note_id: str, body: NoteFavoriteBody):
    from super_notepad import notes_store

    note = notes_store.set_favorite(note_id, body.favorite)
    if note is None:
        raise HTTPException(status_code=404, detail="Nota não encontrada")
    return note


class NoteLockBody(BaseModel):
    locked: bool = True


@router.post("/api/notes/{note_id}/lock")
def notes_lock(note_id: str, body: NoteLockBody):
    """Bloqueia/desbloqueia a nota. Bloqueada = privada ao usuário: o agente não
    a vê nem a toca (segredos, tokens etc.)."""
    from super_notepad import notes_store

    note = notes_store.set_locked(note_id, body.locked)
    if note is None:
        raise HTTPException(status_code=404, detail="Nota não encontrada")
    return note


@router.delete("/api/notes/{note_id}")
def notes_delete(note_id: str):
    from super_notepad import notes_store

    if not notes_store.delete_note(note_id):
        raise HTTPException(status_code=404, detail="Nota não encontrada")
    return {"ok": True}
