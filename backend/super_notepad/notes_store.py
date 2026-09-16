"""Cofre de notas — armazenado em SQLite (``app.db``).

Cada nota tem ``title``/``created``/``updated``/``folder``/``favorite``/``locked``
e um ``id`` estável — renomear o título não quebra links nem a identidade. O
corpo é Markdown puro. Antes eram arquivos ``.md`` por nota + ``.folders.json`` +
``.history/*.jsonl``; migrado para SQLite (ver [[app-db-sqlite]] / app_db.py):
escrita atômica/transacional, sem risco de corrupção, e leitura indexada.

Tabelas: ``not_notes`` (id, colunas + body), ``not_versions`` (histórico),
``not_folders`` (pastas vazias), ``not_folder_meta`` (contexto + tags de memória
da pasta). Migração automática do disco no 1º boot.

Fonte única de armazenamento: a API do painel e as ferramentas do agente batem
todas aqui, então as duas veem exatamente as mesmas notas.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import yaml

from super_notepad import app_db
from super_notepad.constants import get_super_notepad_home

logger = logging.getLogger(__name__)


def notes_dir() -> Path:
    """Diretório do cofre — ainda hospeda os anexos (note_attachments) e o
    ``.history``/``.md`` legados (fonte da migração). Criado sob demanda."""
    d = get_super_notepad_home() / "notes"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _clean_folder(path: str) -> str:
    """Normaliza um caminho de pasta: sem barras nas pontas, sem '..' nem vazios."""
    parts = [p.strip() for p in (path or "").replace("\\", "/").split("/")]
    parts = [p for p in parts if p and p not in (".", "..")]
    return "/".join(parts)


# ---------------------------------------------------------------------------
# Armazenamento (SQLite / app.db)
# ---------------------------------------------------------------------------

_SCHEMA_VERSION = 1
_HISTORY_MAX = 60


def _ddl(conn) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS not_notes (
            id        TEXT PRIMARY KEY,
            title     TEXT,
            folder    TEXT,
            created   TEXT,
            updated   TEXT,
            favorite  INTEGER DEFAULT 0,
            locked    INTEGER DEFAULT 0,
            body      TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS ix_not_updated ON not_notes(updated);
        CREATE INDEX IF NOT EXISTS ix_not_folder  ON not_notes(folder);

        CREATE TABLE IF NOT EXISTS not_versions (
            note_id TEXT NOT NULL,
            ts      TEXT NOT NULL,
            title   TEXT,
            content TEXT,
            PRIMARY KEY (note_id, ts)
        );
        CREATE INDEX IF NOT EXISTS ix_notver_note ON not_versions(note_id);

        CREATE TABLE IF NOT EXISTS not_folders (path TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS not_folder_meta (
            path         TEXT PRIMARY KEY,
            context      TEXT DEFAULT '',
            memory_tags  TEXT DEFAULT '[]'
        );
        """
    )
    if app_db.get_schema_version(conn, "notes") < _SCHEMA_VERSION:
        _migrate_from_disk(conn)
        app_db.set_schema_version(conn, "notes", _SCHEMA_VERSION)


def _ensure() -> None:
    app_db.ensure_schema("notes", _ddl)


# ── Frontmatter/corpo (parse — usado pela migração e como utilitário) ────────

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


def _parse(raw: str) -> tuple[dict[str, Any], str]:
    """Separa frontmatter (YAML) do corpo. Sem cabeçalho, tudo é corpo."""
    match = _FRONTMATTER_RE.match(raw)
    if not match:
        return {}, raw
    try:
        meta = yaml.safe_load(match.group(1)) or {}
        if not isinstance(meta, dict):
            meta = {}
    except yaml.YAMLError:
        meta = {}
    return meta, match.group(2)


_IMG_MD_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")


def _title_from_body(body: str) -> str:
    """Título de emergência: primeiro heading, ou primeira linha não vazia.

    Linhas que são só imagem/vídeo (`![alt](url)`) NÃO viram título.
    """
    for line in body.splitlines():
        stripped = re.sub(r"^#+\s*", "", line.strip())
        if not stripped:
            continue
        no_media = _IMG_MD_RE.sub("", stripped).strip()
        if not no_media:
            continue
        return no_media[:120] or "Sem título"
    return "Sem título"


def _snippet(body: str, limit: int = 160) -> str:
    text = _IMG_MD_RE.sub("", body)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"[*_`>#\-\[\]]", "", text)
    text = " ".join(text.split())
    return text[:limit]


_ID_RE = re.compile(r"^note_[0-9a-f]+_[0-9a-f]{6}$")


def _new_id() -> str:
    return f"note_{int(time.time() * 1000):x}_{uuid.uuid4().hex[:6]}"


def _note_dict(row) -> dict[str, Any]:
    """Constrói o dict de nota (mesma forma do antigo `_read`) a partir da linha."""
    body = row["body"] or ""
    title = str(row["title"] or "").strip() or _title_from_body(body)
    return {
        "id": row["id"],
        "title": title,
        "content": body,
        "folder": _clean_folder(str(row["folder"] or "")),
        "created": row["created"] or "",
        "updated": row["updated"] or "",
        "favorite": bool(row["favorite"]),
        "locked": bool(row["locked"]),
        "snippet": _snippet(body),
    }


def _summary(note: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": note["id"],
        "title": note["title"],
        "snippet": note["snippet"],
        "folder": note.get("folder", ""),
        "created": note["created"],
        "updated": note["updated"],
        "favorite": bool(note.get("favorite")),
        "locked": bool(note.get("locked")),
    }


# ── Migração do disco (arquivos .md + .history + .folders.json + folder-meta) ─


def _migrate_from_disk(conn) -> None:
    if conn.execute("SELECT 1 FROM not_notes LIMIT 1").fetchone():
        return
    d = get_super_notepad_home() / "notes"
    if not d.is_dir():
        return
    note_rows = []
    version_rows = []
    for path in d.glob("*.md"):
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError:
            continue
        meta, body = _parse(raw)
        nid = path.stem
        note_rows.append(
            (
                nid,
                str(meta.get("title") or "").strip() or _title_from_body(body),
                _clean_folder(str(meta.get("folder") or "")),
                meta.get("created") or "",
                meta.get("updated") or "",
                1 if meta.get("favorite") else 0,
                1 if meta.get("locked") else 0,
                body,
            )
        )
    # Histórico: .history/{id}.jsonl (uma versão por linha).
    hist = d / ".history"
    if hist.is_dir():
        for hp in hist.glob("*.jsonl"):
            nid = hp.stem
            try:
                for line in hp.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        v = json.loads(line)
                    except (json.JSONDecodeError, ValueError):
                        continue
                    if isinstance(v, dict) and "ts" in v:
                        version_rows.append(
                            (nid, str(v["ts"]), v.get("title") or "", v.get("content") or "")
                        )
            except OSError:
                continue
    conn.executemany(
        "INSERT OR IGNORE INTO not_notes(id,title,folder,created,updated,favorite,locked,body)"
        " VALUES(?,?,?,?,?,?,?,?)",
        note_rows,
    )
    conn.executemany(
        "INSERT OR IGNORE INTO not_versions(note_id,ts,title,content) VALUES(?,?,?,?)",
        version_rows,
    )
    # Pastas (registro) e metadados de pasta.
    fp = d / ".folders.json"
    if fp.exists():
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
            if isinstance(data, list):
                conn.executemany(
                    "INSERT OR IGNORE INTO not_folders(path) VALUES(?)",
                    [(_clean_folder(str(p)),) for p in data if _clean_folder(str(p))],
                )
        except (OSError, ValueError):
            pass
    mp = d / ".folder-meta.json"
    if mp.exists():
        try:
            data = json.loads(mp.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                rows = []
                for k, v in data.items():
                    fk = _clean_folder(str(k))
                    if fk and isinstance(v, dict):
                        tags = [
                            str(t).strip()
                            for t in (v.get("memory_tags") or [])
                            if str(t).strip()
                        ]
                        rows.append(
                            (fk, str(v.get("context") or ""), json.dumps(tags, ensure_ascii=False))
                        )
                conn.executemany(
                    "INSERT OR IGNORE INTO not_folder_meta(path,context,memory_tags) VALUES(?,?,?)",
                    rows,
                )
        except (OSError, ValueError):
            pass
    if note_rows:
        logger.info("Super-Notepad migradas do disco (%d) para o SQLite (app.db).", len(note_rows))


# ── Pastas ──────────────────────────────────────────────────────────────────


def _folders_in_use() -> set[str]:
    """Pastas mencionadas por alguma nota (inclui os ancestrais do caminho)."""
    used: set[str] = set()
    rows = app_db.connect().execute(
        "SELECT DISTINCT folder FROM not_notes WHERE folder IS NOT NULL AND folder != ''"
    ).fetchall()
    for r in rows:
        folder = _clean_folder(r["folder"])
        if not folder:
            continue
        parts = folder.split("/")
        for i in range(1, len(parts) + 1):
            used.add("/".join(parts[:i]))
    return used


def list_folders() -> list[str]:
    """Todas as pastas (registro + em uso + ancestrais), ordenadas."""
    _ensure()
    reg = {
        r["path"] for r in app_db.connect().execute("SELECT path FROM not_folders")
    }
    folders = reg | _folders_in_use()
    full: set[str] = set()
    for f in folders:
        parts = f.split("/")
        for i in range(1, len(parts) + 1):
            full.add("/".join(parts[:i]))
    return sorted(full)


def create_folder(path: str) -> Optional[str]:
    path = _clean_folder(path)
    if not path:
        return None
    _ensure()
    with app_db.transaction() as conn:
        conn.execute("INSERT OR IGNORE INTO not_folders(path) VALUES(?)", (path,))
    return path


def delete_folder(path: str) -> bool:
    """Remove a pasta (e subpastas) do registro e joga as notas dela para a raiz."""
    path = _clean_folder(path)
    if not path:
        return False
    _ensure()
    like = path + "/%"
    with app_db.transaction() as conn:
        conn.execute(
            "DELETE FROM not_folders WHERE path = ? OR path LIKE ?", (path, like)
        )
        conn.execute(
            "DELETE FROM not_folder_meta WHERE path = ? OR path LIKE ?", (path, like)
        )
        # Super-Notepad da pasta (e subpastas) vão pra raiz.
        conn.execute(
            "UPDATE not_notes SET folder = '' WHERE folder = ? OR folder LIKE ?",
            (path, like),
        )
    return True


def rename_folder(old: str, new: str) -> Optional[str]:
    old, new = _clean_folder(old), _clean_folder(new)
    if not old or not new:
        return None
    _ensure()
    old_like = old + "/"
    with app_db.transaction() as conn:
        # Registro: renomeia a pasta e as subpastas.
        for (p,) in conn.execute(
            "SELECT path FROM not_folders WHERE path = ? OR path LIKE ?",
            (old, old + "/%"),
        ).fetchall():
            np = new + p[len(old):]
            conn.execute("DELETE FROM not_folders WHERE path = ?", (p,))
            conn.execute("INSERT OR IGNORE INTO not_folders(path) VALUES(?)", (np,))
        conn.execute("INSERT OR IGNORE INTO not_folders(path) VALUES(?)", (new,))
        # Folder-meta: move junto.
        for row in conn.execute(
            "SELECT path,context,memory_tags FROM not_folder_meta WHERE path = ? OR path LIKE ?",
            (old, old + "/%"),
        ).fetchall():
            np = new + row["path"][len(old):]
            conn.execute("DELETE FROM not_folder_meta WHERE path = ?", (row["path"],))
            conn.execute(
                "INSERT OR IGNORE INTO not_folder_meta(path,context,memory_tags) VALUES(?,?,?)",
                (np, row["context"], row["memory_tags"]),
            )
        # Super-Notepad: atualiza o campo folder.
        for row in conn.execute(
            "SELECT id,folder FROM not_notes WHERE folder = ? OR folder LIKE ?",
            (old, old + "/%"),
        ).fetchall():
            nf = new + row["folder"][len(old):]
            conn.execute("UPDATE not_notes SET folder = ? WHERE id = ?", (nf, row["id"]))
    return new


# ── Metadados por pasta: CONTEXTO + TAGS DE MEMÓRIA (ver notes_tool) ──────────

_FOLDER_CONTEXT_MAX = 4000


def get_folder_meta(path: str) -> dict[str, Any]:
    path = _clean_folder(path)
    _ensure()
    row = app_db.connect().execute(
        "SELECT context,memory_tags FROM not_folder_meta WHERE path = ?", (path,)
    ).fetchone()
    tags: list[str] = []
    context = ""
    if row:
        context = str(row["context"] or "")
        try:
            tags = [str(t) for t in json.loads(row["memory_tags"] or "[]")]
        except (ValueError, TypeError):
            tags = []
    return {"folder": path, "context": context, "memory_tags": tags}


def set_folder_meta(
    path: str,
    *,
    context: Optional[str] = None,
    memory_tags: Optional[list[str]] = None,
) -> dict[str, Any]:
    path = _clean_folder(path)
    if not path:
        raise ValueError("Pasta inválida.")
    _ensure()
    cur = get_folder_meta(path)
    new_context = cur["context"] if context is None else str(context or "").strip()[:_FOLDER_CONTEXT_MAX]
    if memory_tags is None:
        new_tags = cur["memory_tags"]
    else:
        seen: list[str] = []
        for t in memory_tags:
            s = str(t or "").strip()
            if s and s not in seen:
                seen.append(s)
        new_tags = seen
    with app_db.transaction() as conn:
        if not new_context.strip() and not new_tags:
            conn.execute("DELETE FROM not_folder_meta WHERE path = ?", (path,))
        else:
            conn.execute(
                "INSERT INTO not_folder_meta(path,context,memory_tags) VALUES(?,?,?) "
                "ON CONFLICT(path) DO UPDATE SET context=excluded.context, memory_tags=excluded.memory_tags",
                (path, new_context, json.dumps(new_tags, ensure_ascii=False)),
            )
    return get_folder_meta(path)


# ── Super-Notepad ────────────────────────────────────────────────────────────────────


def list_notes(include_locked: bool = True) -> list[dict[str, Any]]:
    """Todas as notas (resumo, sem corpo), mais recentes primeiro.

    ``include_locked=False`` omite as notas bloqueadas — é como o agente lista.
    """
    _ensure()
    sql = "SELECT * FROM not_notes"
    if not include_locked:
        sql += " WHERE locked = 0"
    # Mais recentes primeiro; rowid ASC desempata (a ordenação do Python era
    # estável — o glob não tinha ordem definida, mas fixamos p/ determinismo).
    sql += " ORDER BY updated DESC, rowid ASC"
    rows = app_db.connect().execute(sql).fetchall()
    return [_summary(_note_dict(r)) for r in rows]


def get_note(note_id: str) -> Optional[dict[str, Any]]:
    if not _ID_RE.match(note_id or ""):
        return None
    _ensure()
    row = app_db.connect().execute(
        "SELECT * FROM not_notes WHERE id = ?", (note_id,)
    ).fetchone()
    return _note_dict(row) if row else None


def create_note(
    title: str = "", content: str = "", folder: str = ""
) -> dict[str, Any]:
    note_id = _new_id()
    now = _now_iso()
    title = (title or "").strip() or _title_from_body(content) or "Sem título"
    folder = _clean_folder(folder)
    body = content or ""
    _ensure()
    with app_db.transaction() as conn:
        conn.execute(
            "INSERT INTO not_notes(id,title,folder,created,updated,favorite,locked,body)"
            " VALUES(?,?,?,?,?,0,0,?)",
            (note_id, title, folder, now, now, body),
        )
        _record_version(conn, note_id, title, body)
        row = conn.execute("SELECT * FROM not_notes WHERE id = ?", (note_id,)).fetchone()
        return _note_dict(row)


def update_note(
    note_id: str,
    title: Optional[str] = None,
    content: Optional[str] = None,
    folder: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    if not _ID_RE.match(note_id or ""):
        return None
    _ensure()
    with app_db.transaction() as conn:
        row = conn.execute("SELECT * FROM not_notes WHERE id = ?", (note_id,)).fetchone()
        if row is None:
            return None
        body = row["body"] or ""
        new_title = row["title"] or ""
        new_folder = row["folder"] or ""
        if content is not None:
            body = content
        if title is not None:
            new_title = title.strip() or _title_from_body(body)
        elif content is not None:
            new_title = _title_from_body(body)
        if folder is not None:
            new_folder = _clean_folder(folder)  # "" = raiz
        created = row["created"] or _now_iso()
        updated = _now_iso()
        conn.execute(
            "UPDATE not_notes SET title=?, body=?, folder=?, created=?, updated=? WHERE id=?",
            (new_title, body, new_folder, created, updated, note_id),
        )
        _record_version(conn, note_id, new_title, body)
        row = conn.execute("SELECT * FROM not_notes WHERE id = ?", (note_id,)).fetchone()
        return _note_dict(row)


def set_favorite(note_id: str, favorite: bool) -> Optional[dict[str, Any]]:
    """Marca/desmarca favorita. NÃO mexe em ``updated`` (favoritar não é editar)."""
    if not _ID_RE.match(note_id or ""):
        return None
    _ensure()
    with app_db.transaction() as conn:
        row = conn.execute("SELECT id FROM not_notes WHERE id = ?", (note_id,)).fetchone()
        if row is None:
            return None
        conn.execute(
            "UPDATE not_notes SET favorite=? WHERE id=?", (1 if favorite else 0, note_id)
        )
        row = conn.execute("SELECT * FROM not_notes WHERE id = ?", (note_id,)).fetchone()
        return _note_dict(row)


def set_locked(note_id: str, locked: bool) -> Optional[dict[str, Any]]:
    """Bloqueia/desbloqueia (privada ao usuário). NÃO mexe em ``updated``."""
    if not _ID_RE.match(note_id or ""):
        return None
    _ensure()
    with app_db.transaction() as conn:
        row = conn.execute("SELECT id FROM not_notes WHERE id = ?", (note_id,)).fetchone()
        if row is None:
            return None
        conn.execute(
            "UPDATE not_notes SET locked=? WHERE id=?", (1 if locked else 0, note_id)
        )
        row = conn.execute("SELECT * FROM not_notes WHERE id = ?", (note_id,)).fetchone()
        return _note_dict(row)


def delete_note(note_id: str) -> bool:
    if not _ID_RE.match(note_id or ""):
        return False
    _ensure()
    with app_db.transaction() as conn:
        cur = conn.execute("DELETE FROM not_notes WHERE id = ?", (note_id,))
        if cur.rowcount == 0:
            return False
        conn.execute("DELETE FROM not_versions WHERE note_id = ?", (note_id,))
    # Anexos órfãos: limpeza best-effort (não falha o delete).
    try:
        collect_attachment_garbage()
    except Exception:
        pass
    return True


def search_notes(
    query: str, limit: int = 20, include_locked: bool = True
) -> list[dict[str, Any]]:
    """Busca por substring no título e no corpo (case-insensitive). Título pesa
    mais. ``include_locked=False`` pula as bloqueadas — usado pelo agente."""
    q = (query or "").strip().lower()
    if not q:
        return list_notes(include_locked=include_locked)[:limit]
    _ensure()
    sql = "SELECT * FROM not_notes WHERE (lower(title) LIKE ? OR lower(body) LIKE ?)"
    like = f"%{q}%"
    params: list[Any] = [like, like]
    if not include_locked:
        sql += " AND locked = 0"
    rows = app_db.connect().execute(sql, params).fetchall()
    hits: list[tuple[int, dict[str, Any]]] = []
    for r in rows:
        note = _note_dict(r)
        title_l = note["title"].lower()
        body_l = note["content"].lower()
        if q not in title_l and q not in body_l:
            continue  # LIKE casou por acento/caixa? o `in` confirma a semântica antiga
        score = (2 if q in title_l else 0) + (1 if q in body_l else 0)
        hits.append((score, note))
    hits.sort(key=lambda t: (t[0], t[1].get("updated") or ""), reverse=True)
    return [_summary(n) for _, n in hits[:limit]]


def resolve_by_title(title: str) -> Optional[dict[str, Any]]:
    """Acha uma nota pelo título exato (case-insensitive) — para links [[wiki]]."""
    want = (title or "").strip().lower()
    if not want:
        return None
    _ensure()
    rows = app_db.connect().execute(
        "SELECT * FROM not_notes ORDER BY updated DESC, rowid ASC"
    ).fetchall()
    for r in rows:
        note = _note_dict(r)
        if note["title"].strip().lower() == want:
            return note
    return None


# ── Linha do tempo (histórico de versões) ───────────────────────────────────
# Toda alteração salva vira uma versão em not_versions. Rede de segurança contra
# perda de conteúdo: dá pra revisar e RESTAURAR. dedup (igual à última é ignorada)
# e teto de 60 versões. Só o painel usa; o agente enxerga sempre a versão ATUAL.


def _record_version(conn, note_id: str, title: str, content: str) -> None:
    """Grava uma versão (na transação corrente). dedup + teto de 60."""
    if not _ID_RE.match(note_id or ""):
        return
    try:
        rows = conn.execute(
            "SELECT ts, content FROM not_versions WHERE note_id = ? ORDER BY ts ASC",
            (note_id,),
        ).fetchall()
        if rows and str(rows[-1]["content"] or "") == (content or ""):
            return  # dedup: igual à última
        # `ts` único (microssegundos) — identifica a versão.
        ts = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT OR IGNORE INTO not_versions(note_id,ts,title,content) VALUES(?,?,?,?)",
            (note_id, ts, title or "", content or ""),
        )
        # Teto: mantém as últimas _HISTORY_MAX.
        conn.execute(
            "DELETE FROM not_versions WHERE note_id = ? AND ts NOT IN ("
            "SELECT ts FROM not_versions WHERE note_id = ? ORDER BY ts DESC LIMIT ?)",
            (note_id, note_id, _HISTORY_MAX),
        )
    except Exception:
        pass  # histórico é auxiliar; nunca derruba o save


def record_version(note_id: str, title: str, content: str) -> None:
    """Grava uma versão avulsa (best-effort). Mantido para compat externa."""
    _ensure()
    try:
        with app_db.transaction() as conn:
            _record_version(conn, note_id, title, content)
    except Exception:
        pass


def list_versions(note_id: str) -> list[dict[str, Any]]:
    """Versões da nota, MAIS RECENTE primeiro: {ts, title, preview, chars}."""
    _ensure()
    rows = app_db.connect().execute(
        "SELECT ts,title,content FROM not_versions WHERE note_id = ? ORDER BY ts DESC",
        (note_id,),
    ).fetchall()
    out: list[dict[str, Any]] = []
    for v in rows:
        content = str(v["content"] or "")
        out.append(
            {
                "ts": v["ts"],
                "title": v["title"] or "",
                "preview": " ".join(content.split())[:120],
                "chars": len(content),
            }
        )
    return out


def get_version(note_id: str, ts: str) -> Optional[dict[str, Any]]:
    """Conteúdo completo de uma versão específica (por timestamp)."""
    _ensure()
    row = app_db.connect().execute(
        "SELECT ts,title,content FROM not_versions WHERE note_id = ? AND ts = ?",
        (note_id, str(ts)),
    ).fetchone()
    if row is None:
        return None
    return {"ts": row["ts"], "title": row["title"] or "", "content": str(row["content"] or "")}


def restore_version(note_id: str, ts: str) -> Optional[dict[str, Any]]:
    """Restaura a nota para uma versão anterior (vira a versão ATUAL; a própria
    restauração é registrada como nova versão)."""
    version = get_version(note_id, ts)
    if version is None:
        return None
    return update_note(note_id, title=None, content=version["content"])


# ── Render (PDF/HTML/texto) — usam get_note, inalterados ─────────────────────

_PDF_CSS = """
@page { size: A4; margin: 22mm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #111; line-height: 1.5; }
h1 { font-size: 20pt; margin: 0 0 8pt; }
h2 { font-size: 15pt; margin: 14pt 0 6pt; }
h3 { font-size: 12.5pt; margin: 12pt 0 4pt; }
p, li { margin: 0 0 6pt; }
ul, ol { margin: 0 0 6pt 16pt; }
pre { background: #f4f4f5; padding: 8pt; border-radius: 4pt; font-family: Courier, monospace; font-size: 9.5pt; }
code { background: #f4f4f5; font-family: Courier, monospace; font-size: 9.5pt; }
blockquote { border-left: 3pt solid #ddd; margin: 0 0 6pt; padding-left: 8pt; color: #555; }
table { border-collapse: collapse; }
td, th { border: 0.5pt solid #ccc; padding: 4pt 6pt; }
a { color: #1a56db; text-decoration: none; }
"""


def _note_body_html(md_text: str) -> str:
    import markdown  # type: ignore

    return markdown.markdown(
        md_text or "", extensions=["extra", "sane_lists", "nl2br"]
    )


def _resolve_note_md(
    note_id: str, content: Optional[str]
) -> Optional[tuple[str, str]]:
    note = get_note(note_id)
    if note is None:
        return None
    md = content if content is not None else (note.get("content") or "")
    return str(note.get("title") or "nota"), md


def render_note_pdf(
    note_id: str, content: Optional[str] = None
) -> Optional[tuple[str, bytes]]:
    resolved = _resolve_note_md(note_id, content)
    if resolved is None:
        return None
    title, md_text = resolved

    import io
    from xhtml2pdf import pisa  # type: ignore

    doc = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{_PDF_CSS}</style></head><body>{_note_body_html(md_text)}</body></html>"
    )
    buf = io.BytesIO()
    result = pisa.CreatePDF(src=doc, dest=buf, encoding="utf-8")
    if result.err:
        raise RuntimeError("Falha ao gerar o PDF da nota.")
    return title, buf.getvalue()


def render_note_html(
    note_id: str, content: Optional[str] = None
) -> Optional[tuple[str, str]]:
    resolved = _resolve_note_md(note_id, content)
    if resolved is None:
        return None
    title, md_text = resolved
    from html import escape

    doc = (
        "<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'>"
        f"<title>{escape(title)}</title><style>{_PDF_CSS}</style></head>"
        f"<body>{_note_body_html(md_text)}</body></html>"
    )
    return title, doc


def render_note_text(
    note_id: str, content: Optional[str] = None
) -> Optional[tuple[str, str]]:
    resolved = _resolve_note_md(note_id, content)
    if resolved is None:
        return None
    title, md_text = resolved
    from html import unescape

    html = _note_body_html(md_text)
    text = re.sub(r"(?i)<br\s*/?>", "\n", html)
    text = re.sub(r"(?i)</(p|div|li|h[1-6]|tr|blockquote|pre)>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return title, (text + "\n")


# ── Anexos (coleta de lixo) ──────────────────────────────────────────────────


def _all_referenced_attachment_ids() -> set[str]:
    """IDs de anexo citados por TODAS as notas vivas (para a coleta de lixo)."""
    from super_notepad import note_attachments

    _ensure()
    ids: set[str] = set()
    for r in app_db.connect().execute("SELECT body FROM not_notes"):
        ids |= note_attachments.extract_ids(r["body"] or "")
    return ids


def collect_attachment_garbage() -> dict[str, int]:
    """Remove anexos que nenhuma nota referencia."""
    from super_notepad import note_attachments

    return note_attachments.prune_unreferenced(_all_referenced_attachment_ids())
