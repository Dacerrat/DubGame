"""Pipeline completo: vídeo -> Dub Pack."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import analisis, audio, diarizacion, separar as sep
from .transcripcion import bloques, es_alucinacion, es_no_voz, limpiar, repartir
from .alinear import Detectada, LineaGuion, alinear, lineas_desde_audio, similitud
from .progreso import informar
from .segmentar import acolchar, construir_lineas, renumerar_hablantes

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
    modelo: str = "turbo"
    separacion: str = "uvr"
    salida: str = "packs"
    id: str | None = None
    hilos: int = max(1, min(8, os.cpu_count() or 4))
    forzar: bool = False
    recorte_auto: bool = True
    margen: float = 1.5


def slug(t: str) -> str:
    t = unicodedata.normalize("NFD", t.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:60] or "pack"


# Los vídeos descargados se guardan para no bajarlos otra vez al rehacer un pack
DIR_DESCARGAS = Path(os.environ.get("DUBGAME_DESCARGAS", Path.home() / ".dubgame" / "descargas"))
INTENTOS_DESCARGA = 4


def error_de_red(e: Exception) -> bool:
    """¿Se ha cortado la conexión (y merece la pena reintentar)?"""
    t = str(e).lower()
    return any(k in t for k in (
        "10053", "10054", "10060", "connection", "conexión", "timed out", "timeout", "reset by peer",
        "incompleteread", "incomplete read", "remote end closed", "temporary failure", "http error 5",
        "eof occurred", "network is unreachable"))


def mensaje_descarga(e: Exception) -> str:
    motivo = re.sub(r"^(\s*(ERROR:|\[[^\]]*\])\s*)+", "", str(e)).strip()
    if error_de_red(e):
        return ("No se pudo descargar el vídeo: la conexión se cortó varias veces (a veces YouTube corta las "
                "descargas). Vuelve a intentarlo dentro de un rato: seguirá donde se quedó. También puedes "
                f"descargar tú el vídeo y usar --video archivo.mp4. Detalle: {motivo}")
    return f"No se pudo descargar el vídeo: {motivo}"


def descargar(objetivo: str) -> tuple[Path, str | None]:
    """Descarga el vídeo (o lo reutiliza si ya se descargó) y devuelve (ruta, título)."""
    import yt_dlp

    carpeta = DIR_DESCARGAS / hashlib.sha1(objetivo.encode("utf-8")).hexdigest()[:16]
    marca = carpeta / "descarga.json"
    try:
        hecho = json.loads(marca.read_text(encoding="utf-8"))
        if (carpeta / hecho["archivo"]).exists():
            informar("descargar", "Vídeo ya descargado antes: no hace falta bajarlo otra vez.", 1.0)
            return carpeta / hecho["archivo"], hecho.get("titulo")
    except (OSError, ValueError, KeyError):
        pass
    carpeta.mkdir(parents=True, exist_ok=True)
    informar("descargar", f"Descargando {objetivo}…")

    def gancho(d: dict) -> None:
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if d.get("status") == "downloading" and total:
            informar("descargar", "Descargando vídeo…", min(1.0, d["downloaded_bytes"] / total))

    def espera(n: int) -> float:
        return min(30.0, 2.0 ** n)

    opciones = {
        "format": "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/bv*+ba/b",
        "outtmpl": str(carpeta / "origen.%(ext)s"),
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "ffmpeg_location": audio.ffmpeg(),
        "progress_hooks": [gancho],
        # Desde Python, yt-dlp no reintenta nada si no se le dice (su línea de
        # órdenes sí): YouTube corta a veces la conexión a mitad de descarga.
        "retries": 10,
        "fragment_retries": 10,
        "extractor_retries": 3,
        "retry_sleep_functions": {"http": espera, "fragment": espera, "extractor": espera},
        "socket_timeout": 30,
        "continuedl": True,
        # En trozos de 10 MB: YouTube limita y corta menos las conexiones cortas
        "http_chunk_size": 10 * 1024 * 1024,
    }
    info: dict | None = None
    for intento in range(1, INTENTOS_DESCARGA + 1):
        try:
            with yt_dlp.YoutubeDL(opciones) as ydl:
                info = ydl.extract_info(objetivo, download=True)
            break
        except yt_dlp.utils.DownloadError as e:
            if intento == INTENTOS_DESCARGA or not error_de_red(e):
                raise RuntimeError(mensaje_descarga(e)) from e
            informar("descargar", f"Se ha cortado la conexión; sigo donde se quedó ({intento + 1}/{INTENTOS_DESCARGA})…")
            time.sleep(5 * intento)
    if info and info.get("entries") is not None:  # búsqueda: el primer resultado
        info = next((e for e in info["entries"] if e), None)
    # El vídeo final (no los trozos intermedios de vídeo y audio, "origen.f137.mp4"…)
    archivos = sorted((p for p in carpeta.glob("origen.*")
                       if p.suffix not in (".part", ".ytdl", ".json") and not re.fullmatch(r"origen\.f[\w-]+", p.stem)),
                      key=lambda p: p.suffix != ".mp4")
    if not archivos:
        raise RuntimeError("yt-dlp no generó ningún archivo")
    titulo = (info or {}).get("title")
    marca.write_text(json.dumps({"objetivo": objetivo, "archivo": archivos[0].name, "titulo": titulo},
                                ensure_ascii=False), encoding="utf-8")
    return archivos[0], titulo


def transcribir_lineas(voz16: np.ndarray, lineas, op: Opciones) -> tuple[list[Detectada], list[Detectada]]:
    """Transcribe las líneas con contexto. Devuelve (líneas con voz, tramos sin voz: música, risas…)."""
    sr = analisis.SR

    def trozo(a: float, b: float) -> np.ndarray:
        return voz16[int(max(0.0, a) * sr):int(b * sr)]

    # Líneas casi mudas (un roce, una respiración): Whisper se inventa ahí cosas
    # como "¡Gracias!". Se comparan con el volumen típico de las voces del clip.
    energias = [audio.rms_db(trozo(l.inicio, l.fin)) for l in lineas]
    referencia = float(np.median(energias)) if energias else -30.0
    sin_voz: set[int] = {i for i, e in enumerate(energias) if e < referencia - 18}

    rapido = op.modelo if op.modelo in ("tiny", "base") else "base"
    informar("transcribir", f"Transcribiendo {len(lineas)} líneas…")
    guia_tr = analisis.Transcriptor(rapido, op.idioma, op.hilos)
    guias = [""] * len(lineas)
    for i, l in enumerate(lineas):
        informar("transcribir", "Primera escucha de cada línea…", i / max(1, len(lineas)))
        if i not in sin_voz:
            guias[i] = guia_tr.transcribir(trozo(l.inicio, l.fin))
    tr = guia_tr if rapido == op.modelo else analisis.Transcriptor(op.modelo, op.idioma, op.hilos)

    textos = list(guias)
    solas: set[int] = set()
    for i, l in enumerate(lineas):
        if i in sin_voz:
            continue
        floja = energias[i] < referencia - 10
        if es_no_voz(guias[i]) or (floja and l.dur < 1.2 and es_alucinacion(guias[i])):
            # Se confirma con el modelo bueno antes de descartar
            t = tr.transcribir(trozo(l.inicio, l.fin))
            if es_no_voz(t) or (floja and es_alucinacion(t)):
                sin_voz.add(i)
            else:
                textos[i] = t
                solas.add(i)

    # Bloques de contexto: nunca cruzan una línea descartada, para que sus
    # palabras (si las hubiera) no acaben en la línea de al lado.
    grupos: list[list[int]] = []
    tramo: list[int] = []
    for i in range(len(lineas) + 1):
        if i < len(lineas) and i not in sin_voz and i not in solas:
            tramo.append(i)
            continue
        if tramo:
            grupos += [[tramo[k] for k in g] for g in bloques([(lineas[j].inicio, lineas[j].fin) for j in tramo])]
            tramo = []
    for g, idx in enumerate(grupos):
        informar("transcribir", f"Transcribiendo con contexto (Whisper {op.modelo})…", g / max(1, len(grupos)))
        if len(idx) == 1:
            textos[idx[0]] = tr.transcribir(trozo(lineas[idx[0]].inicio, lineas[idx[0]].fin))
            continue
        # Solo el audio de las líneas, pegadas con un silencio corto: Whisper tiene
        # contexto pero no oye nada que no sea de estas líneas.
        silencio = np.zeros(int(0.3 * sr), dtype=np.float32)
        partes_audio = []
        for i in idx:
            partes_audio += [trozo(lineas[i].inicio, lineas[i].fin), silencio]
        texto = tr.transcribir(np.concatenate(partes_audio[:-1]))
        partes = repartir(texto, [guias[i] for i in idx], [lineas[i].dur for i in idx])
        if partes is None:
            for i in idx:
                textos[i] = tr.transcribir(trozo(lineas[i].inicio, lineas[i].fin))
        else:
            for i, t in zip(idx, partes):
                textos[i] = t

    con_voz: list[Detectada] = []
    ruido: list[Detectada] = []
    for i, l in enumerate(lineas):
        t = limpiar(textos[i])
        d = Detectada(l.inicio, l.fin, l.hablante, t)
        (ruido if i in sin_voz or es_no_voz(t) else con_voz).append(d)
    return con_voz, ruido


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
        origen, titulo_video = (Path(op.video), None) if op.video else descargar(op.url)
        op.titulo = op.titulo or titulo_video or origen.stem
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
        tramos_voz = analisis.vad(voz16, silencio_min=0.1)
        if not tramos_voz:
            raise RuntimeError("No se ha detectado ninguna voz en el clip")
        informar("diarizar", "Identificando quién habla en cada momento…")

        def emb(ts):
            return analisis.embeddings(voz16, ts, op.hilos)

        piezas = diarizacion.diarizar(voz16, analisis.SR, tramos_voz, op.n_hablantes, emb)
        lineas = diarizacion.revisar_lineas(construir_lineas(piezas), piezas, emb)
        lineas = renumerar_hablantes(lineas)
        lineas = acolchar(lineas, total=total)
        detectadas, ruido = transcribir_lineas(voz16, lineas, op)

        avisos: list[str] = []
        if not detectadas:
            raise RuntimeError("No se ha entendido ninguna frase en el clip")
        if receta:
            informar("alinear", "Ajustando el guion al audio…")
            guion = [LineaGuion(g["p"], g["t"]) for g in receta["guion"]]
            if op.idioma == "es":
                # ¿El clip descargado es de verdad la escena de la receta?
                parecidos = [max(similitud(d.texto, g.texto) for g in guion) for d in detectadas if d.texto.strip()]
                coincidencia = sum(parecidos) / max(1, len(parecidos))
                if coincidencia < 0.35:
                    avisos.append("El audio se parece poco al guion de la receta: puede que el vídeo descargado "
                                  "no sea la escena correcta. Se han usado las frases que se oyen en el clip.")
                    informar("alinear", avisos[-1])
            if op.idioma == "es":
                # Clip en castellano: mandan los tiempos y el texto reales del audio;
                # el guion solo pone nombres (y su texto si coincide con lo que se oye).
                alineadas, sobrantes = lineas_desde_audio(guion, detectadas)
            else:
                alineadas, sobrantes = alinear(guion, detectadas, mismo_idioma=False)
            personajes = [{"id": p["id"], "nombre": p["nombre"]} for p in receta["personajes"]
                          if any(g.personaje == p["id"] for g in guion)]
            lineas_pack = [{
                "personaje": a.personaje, "inicio": a.inicio, "fin": a.fin, "texto": a.texto,
                "textoOriginal": a.texto_original, "confianza": round(a.confianza, 3),
            } for a in alineadas]
            extras = [{"inicio": s.inicio, "fin": s.fin, "texto": s.texto} for s in sobrantes + ruido]
        else:
            hablantes = sorted({d.hablante for d in detectadas})
            personajes = [{"id": f"p{h + 1}", "nombre": f"Personaje {h + 1}"} for h in hablantes]
            lineas_pack = [{
                "personaje": f"p{d.hablante + 1}", "inicio": d.inicio, "fin": d.fin,
                "texto": d.texto if op.idioma == "es" else "", "textoOriginal": d.texto,
                "confianza": 1.0 if d.texto else 0.0,
            } for d in detectadas]
            extras = [{"inicio": r.inicio, "fin": r.fin, "texto": r.texto} for r in ruido]

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
            audio.a_mp3(tmp / "voces.wav", tmp_pack / "voces.mp3")
            audio.a_mp3(tmp / "fondo.wav", tmp_pack / "fondo.mp3")
            v_ini = ini + desplazamiento
            if audio.tiene_video(origen):
                audio.ejecutar(["-ss", f"{v_ini:.3f}", "-i", str(origen), "-t", f"{dur_final:.3f}", "-an",
                                "-vf", "scale=-2:'min(720,ih)',fps=30", "-c:v", "libx264", "-preset", "veryfast",
                                # Fotograma clave cada 0,5 s: saltos rápidos y exactos al sincronizar
                                "-g", "15", "-keyint_min", "15", "-sc_threshold", "0", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
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
                "estado": "listo" if confianza_min >= UMBRAL_LISTO and not avisos else "revisar",
                "avisos": avisos,
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
