"""Vínculos nota↔chat — CRUD e listagem nos dois sentidos."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class LinkBody(BaseModel):
    session_id: str
    note_id: str


class NewNoteBody(BaseModel):
    session_id: str
    title: str = ""
    content: str = ""
    folder: str = ""


@router.get("/api/note-links")
def list_links(session_id: str = "", note_id: str = ""):
    from super_notepad import note_links

    if session_id.strip():
        return {"notes": note_links.notes_for_session(session_id)}
    if note_id.strip():
        # O app de Notas standalone não tem sessões de chat; devolve os ids
        # vinculados (se algum existir) com um título genérico.
        sessions = [
            {"id": sid, "title": "Conversa"}
            for sid in note_links.session_ids_for_note(note_id)
        ]
        return {"sessions": sessions}
    raise HTTPException(status_code=400, detail="Informe session_id ou note_id.")


@router.post("/api/note-links")
def create_link(body: LinkBody):
    from super_notepad import note_links

    try:
        return note_links.link(body.session_id, body.note_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/api/note-links")
def delete_link(session_id: str, note_id: str):
    from super_notepad import note_links

    return note_links.unlink(session_id, note_id)


@router.post("/api/note-links/new-note")
def new_linked_note(body: NewNoteBody):
    """Cria uma nota e já a vincula à conversa (atalho do painel do chat)."""
    from super_notepad import note_links, notes_store

    sid = body.session_id.strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id é obrigatório.")
    try:
        note = notes_store.create_note(
            title=body.title, content=body.content, folder=body.folder
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Falha ao criar nota: {exc}")
    note_links.link(sid, note["id"])
    return {"ok": True, "note": {"id": note["id"], "title": note.get("title") or "Sem título"}}
