"""CLI del motor de Dub Packs.

Ejemplos:
  python -m dubengine crear --receta toy-story-eres-un-juguete
  python -m dubengine crear --video escena.mp4 --titulo "Mi escena" --tipo pelicula
  python -m dubengine crear --url https://youtu.be/... --inicio 1:20 --fin 2:35
  python -m dubengine recetas
  python -m dubengine preparar-recetas            # procesa todas las recetas pendientes
  python -m dubengine modelos                     # descarga los modelos por adelantado
"""
from __future__ import annotations

import argparse
import os
import sys
import traceback
from pathlib import Path

from . import progreso, recetas
from .pipeline import Opciones, procesar
from .recetas import a_segundos


def _comun(p: argparse.ArgumentParser) -> None:
    p.add_argument("--salida", default="packs", help="Carpeta de packs (por defecto ./packs)")
    p.add_argument("--modelo", default="turbo", choices=["tiny", "base", "small", "medium", "turbo"],
                   help="Modelo de Whisper (turbo: el más preciso; base: el más rápido)")
    p.add_argument("--separacion", default="uvr", choices=["uvr", "spleeter", "ninguno"],
                   help="uvr: mejor calidad (por defecto); spleeter: más rápido")
    p.add_argument("--hilos", type=int, default=max(1, min(8, os.cpu_count() or 4)))
    p.add_argument("--forzar", action="store_true", help="Sobrescribe el pack si ya existe")
    p.add_argument("--json", action="store_true", help="Progreso en líneas JSON (uso interno)")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="dubengine", description="Motor de creación de Dub Packs")
    sub = ap.add_subparsers(dest="orden", required=True)

    c = sub.add_parser("crear", help="Crea un pack a partir de un vídeo, URL o receta")
    fuente = c.add_argument_group("fuente")
    fuente.add_argument("--video")
    fuente.add_argument("--url")
    fuente.add_argument("--receta", help="id de receta (engine/recetas) o ruta a un .json")
    c.add_argument("--inicio")
    c.add_argument("--fin")
    c.add_argument("--titulo")
    c.add_argument("--obra")
    c.add_argument("--tipo", default="pelicula", choices=sorted(recetas.TIPOS))
    c.add_argument("--autor", default="anónimo")
    c.add_argument("--idioma", default="es", help="Idioma del audio original (es, en, ja, auto…)")
    c.add_argument("--hablantes", type=int, help="Número de personajes (si se sabe)")
    c.add_argument("--id")
    c.add_argument("--sin-recorte", action="store_true", help="No recortar automáticamente alrededor del diálogo")
    _comun(c)

    sub.add_parser("recetas", help="Lista las recetas disponibles")
    pr = sub.add_parser("preparar-recetas", help="Procesa todas las recetas que aún no tienen pack")
    pr.add_argument("--solo", nargs="*", help="ids concretos")
    _comun(pr)
    sub.add_parser("modelos", help="Descarga por adelantado los modelos necesarios")

    a = ap.parse_args(argv)
    progreso.activar_json(getattr(a, "json", False))
    try:
        if a.orden == "recetas":
            for r in recetas.todas():
                lineas = len(r["guion"])
                print(f"{r['id']:<45} {r['tipo']:<11} {len(r['personajes'])} pers. {lineas:>3} líneas  {r['titulo']}")
            return 0
        if a.orden == "modelos":
            from . import modelos

            for m in ("vad", "embedding", "whisper-base", "whisper-turbo", "uvr"):
                print(modelos.asegurar(m))
            return 0
        if a.orden == "preparar-recetas":
            fallos = []
            for r in recetas.todas():
                if a.solo and r["id"] not in a.solo:
                    continue
                if (Path(a.salida) / r["id"] / "pack.json").exists() and not a.forzar:
                    print(f"✓ {r['id']} (ya existe)")
                    continue
                try:
                    procesar(Opciones(receta=recetas.cargar(r["id"]), salida=a.salida, modelo=a.modelo,
                                      separacion=a.separacion, hilos=a.hilos, forzar=a.forzar))
                    print(f"✓ {r['id']}")
                except Exception as e:  # noqa: BLE001 - seguimos con las demás
                    fallos.append(r["id"])
                    print(f"✗ {r['id']}: {e}")
            return 1 if fallos else 0

        op = Opciones(
            video=a.video, url=a.url, receta=recetas.cargar(a.receta) if a.receta else None,
            inicio=a_segundos(a.inicio), fin=a_segundos(a.fin), titulo=a.titulo, obra=a.obra,
            tipo=a.tipo, autor=a.autor, idioma=a.idioma, n_hablantes=a.hablantes, modelo=a.modelo,
            separacion=a.separacion, salida=a.salida, id=a.id, hilos=a.hilos, forzar=a.forzar,
            recorte_auto=not a.sin_recorte)
        if not (op.video or op.url or op.receta):
            ap.error("indica --video, --url o --receta")
        destino = procesar(op)
        progreso.resultado({"pack": str(destino), "id": destino.name})
        return 0
    except Exception as e:  # noqa: BLE001
        progreso.error(str(e))
        if not progreso._modo_json:
            traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
