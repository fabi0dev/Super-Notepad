"""app.db — SQLite embarcado para os dados ESTRUTURADOS dos apps do Super Note.

Um único arquivo (``<super_notepad_home>/app.db``). Por que SQLite e não JSON solto:

- **Escrita ATÔMICA**: uma transação, não reescrever o arquivo inteiro a cada
  mudancinha (o JSON reescrevia tudo e corria risco de corrupção/corrida).
- **Leitura indexada e agregada**: "gastos por categoria no mês" vira uma query
  com índice em vez de carregar tudo e somar em Python.
- **Um arquivo só** pra backup, com integridade referencial entre domínios.

Arquitetura de concorrência (padrão SQLite de alto desempenho):
- **WAL** (Write-Ahead Logging): leitores concorrentes NÃO bloqueiam o escritor.
- **Conexão por thread** (``threading.local``): conexão sqlite3 não é
  compartilhável entre threads; cada uma abre a sua (WAL deixa várias lerem).
- **`BEGIN IMMEDIATE` + `busy_timeout`**: o SQLite serializa escritores no nível
  do arquivo (inclusive entre PROCESSOS — o que o lock em memória do JSON não
  fazia); a transação espera em vez de estourar.
- **`synchronous=NORMAL`**: com WAL é seguro e bem mais rápido que FULL.

Cada domínio (finance, …) declara seu schema com ``ensure_schema`` e usa
``connect()`` (leitura) / ``transaction()`` (escrita).
"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Callable

from super_notepad.constants import get_super_notepad_home

_local = threading.local()

# O rastreio de "schema já rodado" é POR-THREAD (mora no `_local`), NÃO global:
# as conexões são por-thread e podem apontar pra app.db diferentes (nos testes,
# cada teste tem seu SUPER_NOTEPAD_HOME). Um set global fazia a thread B pular o DDL só
# porque a thread A já o rodara — no banco dela. O DDL é `CREATE IF NOT EXISTS`
# (idempotente) e a MIGRAÇÃO é gateada por `app_meta` (uma vez por banco), então
# rodar o DDL uma vez por thread é barato e correto.


def db_path() -> Path:
    return get_super_notepad_home() / "notes.db"


def _open() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        str(path),
        timeout=30.0,
        # Controlamos as transações à mão (BEGIN IMMEDIATE); em autocommit o
        # sqlite3 do Python não abre transação implícita atrapalhando.
        isolation_level=None,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def connect() -> sqlite3.Connection:
    """Conexão desta thread (abre na primeira vez). Use para LEITURA.

    Reabre se o CAMINHO do banco mudou (`SUPER_NOTEPAD_HOME` diferente) — em produção o
    path nunca muda, mas os testes trocam `SUPER_NOTEPAD_HOME` por-teste no mesmo
    processo, e sem isto a conexão cacheada apontaria pro app.db errado.
    """
    path = str(db_path())
    conn = getattr(_local, "conn", None)
    if conn is not None and getattr(_local, "path", None) != path:
        try:
            conn.close()
        except Exception:
            pass
        conn = None
    if conn is None:
        conn = _open()
        _local.conn = conn
        _local.path = path
        # Nova conexão/arquivo → o DDL ainda não rodou nesta conexão.
        _local.ready_schemas = set()
    return conn


@contextmanager
def transaction():
    """Escrita atômica. `BEGIN IMMEDIATE` pega o write-lock já na entrada, então
    dois writers concorrentes serializam (o 2º espera até `busy_timeout`) em vez
    de um sobrescrever o outro. Commita no sucesso, dá rollback em qualquer erro."""
    conn = connect()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def _ensure_meta(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)")


def get_schema_version(conn: sqlite3.Connection, domain: str) -> int:
    """Versão de schema POR DOMÍNIO (finance, contacts, …). NÃO usar
    `PRAGMA user_version`: ele é ÚNICO por banco e o app.db é compartilhado —
    o 1º domínio a migrar travaria a migração dos outros."""
    _ensure_meta(conn)
    row = conn.execute(
        "SELECT value FROM app_meta WHERE key = ?", (f"schema:{domain}",)
    ).fetchone()
    try:
        return int(row[0]) if row else 0
    except (TypeError, ValueError):
        return 0


def set_schema_version(conn: sqlite3.Connection, domain: str, version: int) -> None:
    _ensure_meta(conn)
    conn.execute(
        "INSERT INTO app_meta(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (f"schema:{domain}", str(int(version))),
    )


def ensure_schema(name: str, ddl: Callable[[sqlite3.Connection], None]) -> None:
    """Roda o DDL do domínio uma vez por processo (idempotente — o DDL deve usar
    CREATE ... IF NOT EXISTS). `name` só evita repetir o trabalho.

    `connect()` PRIMEIRO: se o path do banco mudou (SUPER_NOTEPAD_HOME diferente, nos
    testes), ele reabre e ZERA `_ready_schemas` — só então checamos a membership,
    senão pularíamos o DDL achando que o schema do banco ANTIGO já vale."""
    conn = connect()
    ready = _local.ready_schemas  # criado em connect(), por-thread/conexão
    if name in ready:
        return
    ddl(conn)
    ready.add(name)


def reset_for_tests() -> None:
    """Fecha a conexão da thread e esquece os schemas (só para testes)."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
    _local.conn = None
    _local.ready_schemas = set()
