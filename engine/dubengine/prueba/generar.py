"""Genera las escenas de prueba, las procesa con el motor y mide la precisión.

  python -m dubengine.prueba.generar [--salida packs] [--modelo base] [--sin-receta]
"""
from __future__ import annotations

import argparse
import json
import random
import tempfile
from pathlib import Path

import numpy as np

from .. import audio, modelos
from ..alinear import normalizar
from ..pipeline import Opciones, procesar
from .guiones import ESCENAS

SR = 44100
ANCHO, ALTO = 854, 480


def sintetizar(texto: str, voz: tuple[str, int, float], cache: dict) -> np.ndarray:
    import sherpa_onnx

    nombre, sid, velocidad = voz
    if nombre not in cache:
        rutas = modelos.voz_tts(nombre)
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=rutas["model"], tokens=rutas["tokens"], data_dir=rutas["data_dir"]),
                num_threads=4))
        cache[nombre] = sherpa_onnx.OfflineTts(config)
    tts = cache[nombre]
    gen = tts.generate(texto, sid=sid, speed=velocidad)
    x = np.asarray(gen.samples, dtype=np.float32)
    # Remuestreo lineal a 44.1 kHz
    n = int(len(x) * SR / gen.sample_rate)
    x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    # Recorta silencios de los extremos para conocer los tiempos reales
    umbral = 0.01 * np.max(np.abs(x))
    activo = np.where(np.abs(x) > umbral)[0]
    return x[activo[0]:activo[-1] + 1] if activo.size else x


def musica(dur: float, semilla: int) -> np.ndarray:
    """Fondo sintético: acordes suaves + percusión ligera + ruido de ambiente (estéreo)."""
    rng = np.random.default_rng(semilla)
    t = np.arange(int(dur * SR)) / SR
    acordes = [[220.0, 277.18, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [196.0, 246.94, 329.63]]
    señal = np.zeros_like(t)
    for k, acorde in enumerate(acordes * int(dur // 8 + 1)):
        ini, fin = k * 2.0, (k + 1) * 2.0
        m = (t >= ini) & (t < fin)
        env = np.sin(np.pi * (t[m] - ini) / 2.0) ** 0.5
        for f in acorde:
            señal[m] += env * np.sin(2 * np.pi * f * t[m]) / len(acorde)
    golpes = np.zeros_like(t)
    for b in np.arange(0, dur, 0.5):
        i = int(b * SR)
        largo = min(int(0.08 * SR), len(t) - i)
        golpes[i:i + largo] += rng.standard_normal(largo) * np.exp(-np.arange(largo) / (0.015 * SR))
    ruido = rng.standard_normal(len(t)) * 0.02
    mono = 0.12 * señal + 0.05 * golpes + ruido
    return np.stack([mono, np.roll(mono, 300)]).astype(np.float32)


def tarjeta(texto: str, sub: str, color: str):
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (ANCHO, ALTO), (12, 14, 22))
    d = ImageDraw.Draw(img)
    rgb = tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))
    d.ellipse((ANCHO / 2 - 90, 90, ANCHO / 2 + 90, 270), outline=rgb, width=6)
    grande = ImageFont.load_default(size=96)
    medio = ImageFont.load_default(size=40)
    peq = ImageFont.load_default(size=22)
    d.text((ANCHO / 2, 180), texto[:1].upper(), fill=rgb, font=grande, anchor="mm")
    d.text((ANCHO / 2, 330), texto, fill=(230, 225, 210), font=medio, anchor="mm")
    d.text((ANCHO / 2, 380), sub, fill=(140, 140, 150), font=peq, anchor="mm")
    return img


def construir_escena(esc: dict, carpeta: Path, cache: dict, semilla: int) -> tuple[Path, dict]:
    from ..pipeline import COLORES

    rng = random.Random(semilla)
    pers = {p["id"]: p for p in esc["personajes"]}
    colores = {p["id"]: COLORES[k % len(COLORES)] for k, p in enumerate(esc["personajes"])}
    clips = []
    t = 1.5  # silencio inicial
    verdad = []
    for k, (pid, texto) in enumerate(esc["guion"]):
        # "Frase | resto" = una sola línea con una pausa dramática dentro
        partes = [sintetizar(p.strip(), pers[pid]["voz"], cache) for p in texto.split("|")]
        hueco = np.zeros(int(rng.uniform(*esc.get("pausa_interna", (0.5, 0.7))) * SR), dtype=np.float32)
        x = partes[0]
        for p in partes[1:]:
            x = np.concatenate([x, hueco, p])
        if k > 0 and "pegadas" in esc and rng.random() < esc["pegadas"]:
            t -= rng.uniform(0.1, 0.35)  # contestación pegada: sin pausa o pisando un poco
            t = max(t, verdad[-1]["fin"] - 0.1)
        clips.append((t, x))
        texto_limpio = " ".join(p.strip() for p in texto.split("|"))
        verdad.append({"personaje": pid, "texto": texto_limpio, "inicio": round(t, 3), "fin": round(t + len(x) / SR, 3)})
        t += len(x) / SR + rng.uniform(*esc.get("pausas", (0.45, 1.0)))
    total = t + 1.5
    voces = np.zeros(int(total * SR) + 1, dtype=np.float32)
    for ini, x in clips:
        i = int(ini * SR)
        voces[i:i + len(x)] += x * (0.5 / (np.sqrt(np.mean(x ** 2)) + 1e-9)) * 0.25
    fondo = musica(len(voces) / SR + 0.1, semilla)[:, :len(voces)] * esc.get("musica", 1.0)
    mezcla = np.stack([voces, voces]) + fondo
    mezcla /= max(1.0, float(np.max(np.abs(mezcla))) / 0.95)
    audio.escribir_wav(carpeta / "audio.wav", mezcla, SR)

    # Vídeo: una tarjeta por línea (y la del título en los huecos)
    lista = []
    portada = tarjeta(esc["titulo"], esc["obra"], "#e8d9b5")
    portada.save(carpeta / "titulo.png")
    cursor = 0.0
    for k, v in enumerate(verdad):
        if v["inicio"] > cursor:
            lista.append(("titulo.png", v["inicio"] - cursor))
        nombre = f"l{k}.png"
        tarjeta(pers[v["personaje"]]["nombre"], esc["titulo"], colores[v["personaje"]]).save(carpeta / nombre)
        fin = verdad[k + 1]["inicio"] if k + 1 < len(verdad) else total
        lista.append((nombre, fin - v["inicio"]))
        cursor = fin
    with open(carpeta / "lista.txt", "w") as f:
        for nombre, dur in lista:
            f.write(f"file '{nombre}'\nduration {dur:.3f}\n")
        f.write(f"file '{lista[-1][0]}'\n")
    salida = carpeta / f"{esc['id']}.mp4"
    audio.ejecutar(["-f", "concat", "-safe", "0", "-i", str(carpeta / "lista.txt"), "-i", str(carpeta / "audio.wav"),
                    "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
                    "-c:a", "aac", "-b:a", "160k", "-shortest", str(salida)])
    receta = {
        "id": esc["id"], "titulo": esc["titulo"], "obra": esc["obra"], "tipo": "prueba",
        "idiomaOriginal": "es", "fuente": {"busqueda": "(generada localmente)"},
        "personajes": [{"id": p["id"], "nombre": p["nombre"]} for p in esc["personajes"]],
        "guion": [{"p": p, "t": " ".join(x.strip() for x in t.split("|"))} for p, t in esc["guion"]],
    }
    return salida, {"receta": receta, "verdad": verdad, "duracion": total}


def wer(ref: str, hip: str) -> float:
    r, h = normalizar(ref).split(), normalizar(hip).split()
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
    return d[len(h)] / max(1, len(r))


def evaluar(pack: dict, verdad: list[dict], desplazamiento: float, con_receta: bool) -> dict:
    """Compara el pack generado con la verdad conocida."""
    lineas = pack["lineas"]
    # Sin receta, los personajes son "p1, p2…": se busca la mejor correspondencia
    mapa: dict[str, str] = {}
    if not con_receta:
        votos: dict[tuple[str, str], float] = {}
        for v in verdad:
            for l in lineas:
                s = max(0.0, min(v["fin"], l["fin"] + desplazamiento) - max(v["inicio"], l["inicio"] + desplazamiento))
                votos[(l["personaje"], v["personaje"])] = votos.get((l["personaje"], v["personaje"]), 0) + s
        for (lp, vp), _ in sorted(votos.items(), key=lambda kv: -kv[1]):
            if lp not in mapa and vp not in mapa.values():
                mapa[lp] = vp
    aciertos, err_ini, err_fin, wers = 0, [], [], []
    for v in verdad:
        mejor, mejor_s = None, 0.0
        for l in lineas:
            s = min(v["fin"], l["fin"] + desplazamiento) - max(v["inicio"], l["inicio"] + desplazamiento)
            if s > mejor_s:
                mejor, mejor_s = l, s
        if mejor is None:
            continue
        p = mejor["personaje"] if con_receta else mapa.get(mejor["personaje"])
        aciertos += p == v["personaje"]
        err_ini.append(abs(mejor["inicio"] + desplazamiento - v["inicio"]))
        err_fin.append(abs(mejor["fin"] + desplazamiento - v["fin"]))
        wers.append(wer(v["texto"], mejor.get("textoOriginal", "")))
    n = len(verdad)
    return {
        "lineasVerdad": n,
        "lineasPack": len(lineas),
        "personajeCorrecto": round(aciertos / n, 3),
        "errorInicioMedio": round(float(np.mean(err_ini)), 3) if err_ini else None,
        "errorFinMedio": round(float(np.mean(err_fin)), 3) if err_fin else None,
        "lineasDentroTolerancia": round(sum(1 for a, b in zip(err_ini, err_fin) if a <= 0.4 and b <= 0.4) / n, 3),
        "wer": round(float(np.mean(wers)), 3) if wers else None,
        "textoExacto": all(l["texto"] == v["texto"] for l, v in zip(sorted(lineas, key=lambda x: x["inicio"]), verdad)) if con_receta else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default="packs")
    ap.add_argument("--modelo", default="base")
    ap.add_argument("--sin-receta", action="store_true", help="Evalúa el modo totalmente automático")
    ap.add_argument("--solo", nargs="*")
    ap.add_argument("--fuentes", help="Carpeta donde guardar los vídeos fuente generados")
    a = ap.parse_args()
    cache: dict = {}
    informe = {}
    with tempfile.TemporaryDirectory() as tmp_str:
        for k, esc in enumerate(ESCENAS):
            if a.solo and esc["id"] not in a.solo:
                continue
            carpeta = Path(tmp_str) / esc["id"]
            carpeta.mkdir()
            video, info = construir_escena(esc, carpeta, cache, semilla=k + 7)
            if a.fuentes:
                Path(a.fuentes).mkdir(parents=True, exist_ok=True)
                (Path(a.fuentes) / video.name).write_bytes(video.read_bytes())
                audio.guardar_json(Path(a.fuentes) / f"{esc['id']}.verdad.json", info)
            op = Opciones(video=str(video), salida=a.salida, modelo=a.modelo, forzar=True, autor="DubGame")
            if a.sin_receta:
                op.id = esc["id"] + "-auto"
                op.titulo = esc["titulo"] + " (auto)"
                op.tipo = "prueba"
            else:
                op.receta = info["receta"]
            destino = procesar(op)
            pack = json.loads((destino / "pack.json").read_text(encoding="utf-8"))
            desplazamiento = pack["fuente"]["inicio"]
            informe[esc["id"]] = evaluar(pack, info["verdad"], desplazamiento, con_receta=not a.sin_receta)
            print(json.dumps({esc["id"]: informe[esc["id"]]}, ensure_ascii=False))
    print(json.dumps(informe, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
