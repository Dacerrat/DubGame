"""Informe de progreso: texto legible o líneas JSON (para el servidor)."""
from __future__ import annotations

import json
import sys

_modo_json = False


def activar_json(activo: bool) -> None:
    global _modo_json
    _modo_json = activo


def informar(fase: str, mensaje: str, fraccion: float | None = None) -> None:
    if _modo_json:
        print(json.dumps({"tipo": "progreso", "fase": fase, "mensaje": mensaje, "fraccion": fraccion},
                         ensure_ascii=False), flush=True)
    else:
        extra = f" ({fraccion * 100:.0f}%)" if fraccion is not None else ""
        print(f"[{fase}] {mensaje}{extra}", file=sys.stderr, flush=True)


def resultado(datos: dict) -> None:
    if _modo_json:
        print(json.dumps({"tipo": "resultado", **datos}, ensure_ascii=False), flush=True)
    else:
        print(json.dumps(datos, ensure_ascii=False, indent=2))


def error(mensaje: str) -> None:
    if _modo_json:
        print(json.dumps({"tipo": "error", "mensaje": mensaje}, ensure_ascii=False), flush=True)
    else:
        print(f"ERROR: {mensaje}", file=sys.stderr, flush=True)
