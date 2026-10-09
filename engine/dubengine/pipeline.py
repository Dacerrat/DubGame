"""Pipeline completo: vídeo -> Dub Pack."""
from __future__ import annotations

import re
import shutil
import tempfile
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import analisis, audio, separar as sep
from .alinear import Detectada, LineaGuion, alinear
from .progreso import informar
from .segmentar import acolchar, agrupar, asignar_hablantes, construir_lineas, renumerar_hablantes

COLORES = ["#e8d9b5", "#8fb8de", "#de8f8f", "#a6d98f", "#c9a6e0", "#e0bb85", "#85d0c9", "#d985b8"]
UMBRAL_LISTO = 0.45


@dataclass
class Opciones:
    video: str | None = None
    url: str | None = None
    receta: dict | None = None
    inicio: float | None = None
    fin: float | None = None
    titulo: str | None = None
    obra: str | None = None
    tipo: str = "pelicula"
    autor: str = "anónimo"
    idioma: str = "es"
    n_hablantes: int | None = None
    modelo: str = "small"
    separacion: str = "spleeter"
    salida: str = "packs"
    id: str | None = None
    hilos: int = 4
    forzar: bool = False
    recorte_auto: bool = True
    margen: float = 1.5


def slug(t: str) -> str:
    t = unicodedata.normalize("NFD", t.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:60] or "pack"


def descargar(objetivo: str, carpeta: Path) -> Path:
    import yt_dlp

    informar("descargar", f"Descargando {objetivo}…")

    def gancho(d: dict) -> None:
        if d.get("status") == "downloading" and d.get("total_bytes"):
            informar("descargar", "Descargando vídeo…", d["downloaded_bytes"] / d["total_bytes"])

    opciones = {
        "format": "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/bv*+ba/b",
        "outtmpl": str(carpeta / "origen.%(ext)s"),
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "ffmpeg_location": audio.ffmpeg(),
        "progress_hooks": [gancho],
    }
    with yt_dlp.YoutubeDL(opciones) as ydl:
        ydl.download([objetivo])
    archivos = [p for p in carpeta.glob("origen.*") if p.suffix not in (".part", ".ytdl")]
    if not archivos:
        raise RuntimeError("yt-dlp no generó ningún archivo")
    return archivos[0]


def procesar(op: Opciones) -> Path:
    t0 = time.time()
    receta = op.receta
    if receta:
        fuente = receta.get("fuente", {})
        from .recetas import a_segundos

        op.inicio = op.inicio if op.inicio is not None else a_segundos(fuente.get("inicio"))
        op.fin = op.fin if op.fin is not None else a_segundos(fuente.get("fin"))
        op.titulo = op.titulo or receta["titulo"]
        op.obra = op.obra or receta["obra"]
        op.tipo = receta["tipo"]
        op.idioma = receta.get("idiomaOriginal", op.idioma)
        op.n_hablantes = op.n_hablantes or len({l["p"] for l in receta["guion"]})
        op.id = op.id or receta["id"]
        if not op.url and not op.video:
            op.url = fuente.get("url") or f"ytsearch1:{fuente['busqueda']}"

    salida_base = Path(op.salida)
    with tempfile.TemporaryDirectory(prefix="dubpack-") as tmp_str:
        tmp = Path(tmp_str)
        origen = Path(op.video) if op.video else descargar(op.url, tmp)
        op.titulo = op.titulo or origen.stem
        op.obra = op.obra or op.titulo
        pack_id = op.id or slug(op.titulo)
        destino = salida_base / pack_id
        if destino.exists() and not op.forzar:
            raise FileExistsError(f"Ya existe el pack '{pack_id}' (usa --forzar para sobrescribir)")

        dur_origen = audio.duracion(origen)
        ini = max(0.0, op.inicio or 0.0)
        fin = min(dur_origen, op.fin) if op.fin else dur_origen

        informar("audio", "Extrayendo audio…")
        estereo = audio.leer(origen, sep.SR, canales=2, inicio=ini, fin=fin)
        if estereo.shape[1] < sep.SR:
            raise RuntimeError("El tramo de vídeo es demasiado corto")
        voces, fondo = sep.separar(estereo, op.separacion, op.hilos)
        audio.escribir_wav(tmp / "voces44.wav", voces, sep.SR)
        voz16 = audio.leer(tmp / "voces44.wav", analisis.SR)
        total = len(voz16) / analisis.SR

        informar("vad", "Detectando tramos de voz…")
        tramos_voz = analisis.vad(voz16)
        if not tramos_voz:
            raise RuntimeError("No se ha detectado ninguna voz en el clip")
        if op.n_hablantes == 1:
            piezas = [analisis.Tramo(t.inicio, t.fin, 0) for t in tramos_voz]
        else:
            # La diarización de sherpa solo se usa para encontrar cambios de
            # hablante dentro de un tramo; el agrupamiento lo hacemos nosotros.
            diar = analisis.diarizar(voz16, None, hilos=op.hilos)
            piezas = asignar_hablantes(tramos_voz, diar)
            informar("diarizar", f"Agrupando {len(piezas)} tramos por voz…")
            emb = analisis.embeddings(voz16, piezas, op.hilos)
            etiquetas = agrupar(emb, [p.dur for p in piezas], op.n_hablantes)
            for p, e in zip(piezas, etiquetas):
                p.hablante = e
        lineas = renumerar_hablantes(construir_lineas(piezas))
        lineas = acolchar(lineas, total=total)

        informar("transcribir", f"Transcribiendo {len(lineas)} líneas (Whisper {op.modelo})…")
        tr = analisis.Transcriptor(op.modelo, op.idioma, op.hilos)
        detectadas: list[Detectada] = []
        for k, l in enumerate(lineas):
            informar("transcribir", "Transcribiendo…", k / max(1, len(lineas)))
            trozo = voz16[int(l.inicio * analisis.SR):int(l.fin * analisis.SR)]
            detectadas.append(Detectada(l.inicio, l.fin, l.hablante, tr.transcribir(trozo)))

        if receta:
            informar("alinear", "Ajustando el guion al audio…")
            guion = [LineaGuion(g["p"], g["t"]) for g in receta["guion"]]
            alineadas, sobrantes = alinear(guion, detectadas, mismo_idioma=op.idioma == "es")
            personajes = [{"id": p["id"], "nombre": p["nombre"]} for p in receta["personajes"]
                          if any(g.personaje == p["id"] for g in guion)]
            lineas_pack = [{
                "personaje": a.personaje, "inicio": a.inicio, "fin": a.fin, "texto": a.texto,
                "textoOriginal": a.texto_original, "confianza": round(a.confianza, 3),
            } for a in alineadas]
            extras = [{"inicio": s.inicio, "fin": s.fin, "texto": s.texto} for s in sobrantes]
        else:
            hablantes = sorted({d.hablante for d in detectadas})
            personajes = [{"id": f"p{h + 1}", "nombre": f"Personaje {h + 1}"} for h in hablantes]
            lineas_pack = [{
                "personaje": f"p{d.hablante + 1}", "inicio": d.inicio, "fin": d.fin,
                "texto": d.texto if op.idioma == "es" else "", "textoOriginal": d.texto,
                "confianza": 1.0 if d.texto else 0.0,
            } for d in detectadas]
            extras = []

        # Recorte automático alrededor del diálogo cuando no se indicó tramo
        desplazamiento = 0.0
        recorte_fin = total
        if op.recorte_auto and op.inicio is None and op.fin is None and lineas_pack:
            desplazamiento = max(0.0, min(l["inicio"] for l in lineas_pack) - op.margen)
            recorte_fin = min(total, max(l["fin"] for l in lineas_pack) + op.margen)
        for l in lineas_pack + extras:
            l["inicio"] = round(l["inicio"] - desplazamiento, 3)
            l["fin"] = round(l["fin"] - desplazamiento, 3)
        extras = [e for e in extras if e["fin"] > 0 and e["inicio"] < recorte_fin - desplazamiento]

        lineas_pack.sort(key=lambda l: l["inicio"])
        for k, l in enumerate(lineas_pack):
            l["id"] = f"l{k + 1:02d}"
        for k, p in enumerate(personajes):
            p["color"] = COLORES[k % len(COLORES)]

        a0 = int(desplazamiento * sep.SR)
        a1 = int(recorte_fin * sep.SR)
        dur_final = (a1 - a0) / sep.SR

        informar("exportar", "Exportando vídeo y audio…")
        tmp_pack = Path(tempfile.mkdtemp(prefix=f".{pack_id}-", dir=salida_base.resolve() if salida_base.exists() else None))
        try:
            audio.escribir_wav(tmp / "voces.wav", voces[:, a0:a1], sep.SR)
            audio.escribir_wav(tmp / "fondo.wav", fondo[:, a0:a1], sep.SR)
            audio.a_m4a(tmp / "voces.wav", tmp_pack / "voces.m4a")
            audio.a_m4a(tmp / "fondo.wav", tmp_pack / "fondo.m4a")
            v_ini = ini + desplazamiento
            if audio.tiene_video(origen):
                audio.ejecutar(["-ss", f"{v_ini:.3f}", "-i", str(origen), "-t", f"{dur_final:.3f}", "-an",
                                "-vf", "scale=-2:'min(720,ih)',fps=30", "-c:v", "libx264", "-preset", "veryfast",
                                "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                                str(tmp_pack / "video.mp4")])
                t_portada = (lineas_pack[0]["inicio"] + lineas_pack[0]["fin"]) / 2 if lineas_pack else dur_final / 2
                audio.ejecutar(["-ss", f"{v_ini + t_portada:.3f}", "-i", str(origen), "-frames:v", "1",
                                "-vf", "scale=480:-2", "-q:v", "4", str(tmp_pack / "portada.jpg")])

            confianza_min = min((l["confianza"] for l in lineas_pack), default=0.0)
            pack = {
                "version": 1,
                "id": pack_id,
                "titulo": op.titulo,
                "obra": op.obra,
                "tipo": op.tipo,
                "autor": op.autor,
                "idiomaOriginal": op.idioma,
                "duracion": round(dur_final, 3),
                "estado": "listo" if confianza_min >= UMBRAL_LISTO else "revisar",
                "creado": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "fuente": {"url": op.url, "inicio": round(v_ini, 3), "fin": round(v_ini + dur_final, 3)},
                "personajes": personajes,
                "lineas": lineas_pack,
                "extras": extras,
            }
            audio.guardar_json(tmp_pack / "pack.json", pack)
            if destino.exists():
                shutil.rmtree(destino)
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(tmp_pack), destino)
        finally:
            if tmp_pack.exists():
                shutil.rmtree(tmp_pack, ignore_errors=True)

    informar("listo", f"Pack '{pack_id}' creado en {time.time() - t0:.0f} s "
                      f"({len(lineas_pack)} líneas, {len(personajes)} personajes, estado {pack['estado']})")
    return destino
