"""Carga y validación de recetas (escenas famosas preparadas)."""
from __future__ import annotations

import json
from pathlib import Path

CARPETA = Path(__file__).resolve().parent.parent / "recetas"
TIPOS = {"pelicula", "videojuego", "disney", "serie", "prueba"}


def a_segundos(v) -> float | None:
    """Acepta 83, 83.5, "1:23", "01:02:03.5" o None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    total = 0.0
    for parte in str(v).split(":"):
        total = total * 60 + float(parte)
    return total


def validar(r: dict) -> list[str]:
    errores = []
    for campo in ("id", "titulo", "obra", "tipo", "personajes", "guion"):
        if campo not in r:
            errores.append(f"falta '{campo}'")
    if errores:
        return errores
    if r["tipo"] not in TIPOS:
        errores.append(f"tipo desconocido '{r['tipo']}'")
    ids = [p["id"] for p in r["personajes"]]
    if len(set(ids)) != len(ids):
        errores.append("ids de personaje repetidos")
    for k, linea in enumerate(r["guion"]):
        if linea.get("p") not in ids:
            errores.append(f"línea {k + 1}: personaje '{linea.get('p')}' no existe")
        if not str(linea.get("t", "")).strip():
            errores.append(f"línea {k + 1}: texto vacío")
    fuente = r.get("fuente", {})
    if not (fuente.get("url") or fuente.get("busqueda")):
        errores.append("la fuente necesita 'url' o 'busqueda'")
    return errores


def cargar(id_o_ruta: str) -> dict:
    ruta = Path(id_o_ruta)
    if not ruta.exists():
        ruta = CARPETA / f"{id_o_ruta}.json"
    if not ruta.exists():
        raise FileNotFoundError(f"No existe la receta '{id_o_ruta}'")
    r = json.loads(ruta.read_text(encoding="utf-8"))
    errores = validar(r)
    if errores:
        raise ValueError(f"Receta {ruta.name} no válida: " + "; ".join(errores))
    return r


def todas() -> list[dict]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(CARPETA.glob("*.json"))]
