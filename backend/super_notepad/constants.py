"""Constantes e caminhos do app de Super-Notepad.

Módulo import-safe (sem dependências além da stdlib) — a única fonte da verdade
para a home dos dados. Todo o resto do backend deriva os caminhos daqui.
"""

from __future__ import annotations

import os
from pathlib import Path


def safe_getcwd() -> str:
    """Diretório de trabalho atual, ou HOME se ele tiver sido removido."""
    try:
        return os.getcwd()
    except (FileNotFoundError, OSError):
        return str(Path.home())


def get_super_notepad_home() -> Path:
    """Home dos dados do app (padrão: ``~/.super-notepad``).

    Fonte única da verdade para onde ficam os dados. Sobrescreva com a variável
    de ambiente ``SUPER_NOTEPAD_HOME``.
    """
    val = os.environ.get("SUPER_NOTEPAD_HOME", "").strip()
    if val:
        return Path(val)
    return Path.home() / ".super-notepad"
