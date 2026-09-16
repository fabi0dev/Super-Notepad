"""Vínculos nota↔chat — relação muitos-para-muitos no SQLite (``app.db``).

Liga uma conversa (``session_id``, a mesma que o painel usa) a uma ou mais notas
(``note_id`` do notes_store). Serve para: no chat, ver/abrir/criar notas ligadas
à conversa; nas Notas, ver as conversas ligadas; e para o agente usar as notas
vinculadas como contexto ao trabalhar naquela conversa.

É uma tabela de ARESTAS pura — o caso ideal pro modelo relacional: PK composta
`(session_id, note_id)` (dedup grátis) + índice em `note_id` (consulta pelos dois
lados é indexada). Migra do note_links.json uma vez. Ver [[app-db-sqlite]].
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from super_notepad import app_db
from super_notepad.constants import get_super_notepad_home

logger = logging.getLogger(__name__)

_SCHEMA_VERSION = 1


def _ddl(conn) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS nl_links (
            session_id TEXT NOT NULL,
            note_id    TEXT NOT NULL,
            created_at REAL,
            PRIMARY KEY (session_id, note_id)
        );
        CREATE INDEX IF NOT EXISTS ix_nl_note ON nl_links(note_id);
        """
    )
    if app_db.get_schema_version(conn, "note_links") < _SCHEMA_VERSION:
        _migrate_from_json(conn)
        app_db.set_schema_version(conn, "note_links", _SCHEMA_VERSION)


def _ensure() -> None:
    app_db.ensure_schema("note_links", _ddl)


def _migrate_from_json(conn) -> None:
    if conn.execute("SELECT 1 FROM nl_links LIMIT 1").fetchone():
        return
    src = get_super_notepad_home() / "note_links.json"
    if not src.exists():
        return
    try:
        legacy = json.loads(src.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    links = legacy.get("links") if isinstance(legacy, dict) else None
    if not isinstance(links, list):
        return
    rows = []
    for e in links:
        if not isinstance(e, dict):
            continue
        sid = (e.get("session_id") or "").strip()
        nid = (e.get("note_id") or "").strip()
        if sid and nid:
            rows.append((sid, nid, float(e.get("created_at") or 0)))
    # OR IGNORE: a PK composta cuida de duplicatas (mantém a 1ª — ordem do JSON).
    conn.executemany(
        "INSERT OR IGNORE INTO nl_links(session_id,note_id,created_at) VALUES(?,?,?)",
        rows,
    )
    if rows:
        logger.info("Vínculos nota↔chat migrados de note_links.json para o SQLite.")


def _norm(sid: str, nid: str) -> tuple[str, str]:
    return (sid or "").strip(), (nid or "").strip()


def link(session_id: str, note_id: str) -> dict[str, Any]:
    sid, nid = _norm(session_id, note_id)
    if not sid or not nid:
        raise ValueError("session_id e note_id são obrigatórios.")
    _ensure()
    with app_db.transaction() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO nl_links(session_id,note_id,created_at) VALUES(?,?,?)",
            (sid, nid, time.time()),
        )
        # rowcount = 1 se inseriu, 0 se já existia (ON CONFLICT IGNORE).
        return {"ok": True, "linked": cur.rowcount > 0}


def unlink(session_id: str, note_id: str) -> dict[str, Any]:
    sid, nid = _norm(session_id, note_id)
    _ensure()
    with app_db.transaction() as conn:
        cur = conn.execute(
            "DELETE FROM nl_links WHERE session_id = ? AND note_id = ?", (sid, nid)
        )
        return {"ok": True, "removed": cur.rowcount}


def note_ids_for_session(session_id: str) -> list[str]:
    sid = (session_id or "").strip()
    if not sid:
        return []
    _ensure()
    # Mais recentes primeiro; rowid ASC desempata (ordem de inserção).
    rows = app_db.connect().execute(
        "SELECT note_id FROM nl_links WHERE session_id = ? "
        "ORDER BY created_at DESC, rowid ASC",
        (sid,),
    ).fetchall()
    return [r["note_id"] for r in rows]


def session_ids_for_note(note_id: str) -> list[str]:
    nid = (note_id or "").strip()
    if not nid:
        return []
    _ensure()
    rows = app_db.connect().execute(
        "SELECT session_id FROM nl_links WHERE note_id = ? "
        "ORDER BY created_at DESC, rowid ASC",
        (nid,),
    ).fetchall()
    return [r["session_id"] for r in rows]


def notes_for_session(session_id: str) -> list[dict[str, Any]]:
    """Notas vinculadas (resumo: id, title) — só as que ainda existem."""
    from super_notepad import notes_store

    out: list[dict[str, Any]] = []
    for nid in note_ids_for_session(session_id):
        note = notes_store.get_note(nid)
        if note is None:
            continue
        out.append({"id": note["id"], "title": note.get("title") or "Sem título"})
    return out


def prune_note(note_id: str) -> None:
    """Remove vínculos de uma nota apagada."""
    nid = (note_id or "").strip()
    if not nid:
        return
    _ensure()
    with app_db.transaction() as conn:
        conn.execute("DELETE FROM nl_links WHERE note_id = ?", (nid,))


def delete_links_for_session(session_id: str) -> None:
    """Remove vínculos de uma CONVERSA apagada (espelho de prune_note). Sem isto,
    notes_for_session/session_ids_for_note continuariam apontando para uma sessão
    que não existe mais. nl_links é um DB separado do de sessões, então a limpeza
    é uma chamada explícita (não há FK em cascata)."""
    sid = (session_id or "").strip()
    if not sid:
        return
    _ensure()
    with app_db.transaction() as conn:
        conn.execute("DELETE FROM nl_links WHERE session_id = ?", (sid,))
