"""Persistência JSON segura para os stores locais (lembretes, tarefas…).

Três garantias que os stores precisam e antes não tinham:

- **Escrita atômica sem colisão de temp**: grava num temporário ÚNICO (pid +
  aleatório) no mesmo diretório e faz ``os.replace``. Dois writers simultâneos
  (até no mesmo processo) nunca escrevem no mesmo arquivo temporário.
- **Serialização do read-modify-write**: ``mutate`` segura um lock por caminho
  enquanto carrega → altera → grava. As rotas FastAPI são ``def`` síncronas
  (rodam no threadpool) e as tools do agente mexem no mesmo arquivo — sem o
  lock, dois updates se sobrescreviam (lost update).
- **Corrompido não vira perda silenciosa**: se o arquivo estiver ilegível,
  preserva uma cópia ``.corrupt-<ts>`` ANTES que qualquer save o sobrescreva,
  e devolve o default para o app seguir de pé.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

# Um lock por caminho de arquivo. Serializa o ciclo load→mutate→save dentro do
# processo (é single-process: daemon + threadpool + thread do agente).
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def lock_for(path: Path) -> threading.Lock:
    key = str(path)
    with _locks_guard:
        lk = _locks.get(key)
        if lk is None:
            lk = threading.Lock()
            _locks[key] = lk
        return lk


def load_json(path: Path, default: Any) -> Any:
    """Carrega o JSON; em corrompido faz backup e devolve ``default``.

    O ``default`` deve ser um valor NOVO a cada chamada (ex.: ``{"tasks": []}``),
    nunca um literal compartilhado — quem chama pode mutá-lo.
    """
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except Exception:
        # Preserva o arquivo ruim antes que o próximo save o apague. Sem isto,
        # um único write corrompido + qualquer mutação = tudo perdido em
        # silêncio (o antigo _load devolvia lista vazia e o save gravava vazio).
        try:
            backup = path.with_name(f"{path.name}.corrupt-{int(time.time())}")
            os.replace(path, backup)
            logger.warning("%s ilegível; backup preservado em %s", path.name, backup.name)
        except OSError:
            logger.debug("%s ilegível e sem backup possível", path.name, exc_info=True)
        return default


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass


def mutate(path: Path, loader: Callable[[], Any], fn: Callable[[Any], Any]) -> Any:
    """Read-modify-write serializado.

    Segura o lock do ``path``, chama ``loader()`` (que deve ler e normalizar o
    arquivo), aplica ``fn(data)`` — que altera ``data`` in-place e devolve o
    valor a retornar ao chamador — e grava ``data`` de forma atômica.
    """
    with lock_for(path):
        data = loader()
        result = fn(data)
        atomic_write_json(path, data)
        return result
