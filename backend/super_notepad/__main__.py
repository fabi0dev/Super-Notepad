"""Entrypoint: ``python -m super_notepad [--port 9010] [--host 127.0.0.1] [--no-open]``."""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(prog="super_notepad", description="App de Super-Notepad")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9010)
    parser.add_argument(
        "--no-open", action="store_true", help="não abrir o navegador no arranque"
    )
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="permitir vincular a um host não-loopback (não recomendado)",
    )
    args = parser.parse_args()

    from super_notepad.web_server import start_server

    start_server(
        host=args.host,
        port=args.port,
        open_browser=not args.no_open,
        allow_public=args.insecure,
    )


if __name__ == "__main__":
    main()
