"""Descarga perezosa de los modelos de sherpa-onnx (releases de GitHub).

Los modelos se guardan en ~/.dubgame/modelos (o en $DUBGAME_MODELOS) y solo se
descargan la primera vez que se necesitan.
"""
from __future__ import annotations

import os
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path

from .progreso import informar

BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download"

# nombre -> (ruta en la release, es_tarball)
CATALOGO: dict[str, tuple[str, bool]] = {
    "vad": ("asr-models/silero_vad.onnx", False),
    "segmentacion": ("speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2", True),
    "embedding": ("speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx", False),
    "embedding-titanet": ("speaker-recongition-models/nemo_en_titanet_small.onnx", False),
    "whisper-tiny": ("asr-models/sherpa-onnx-whisper-tiny.tar.bz2", True),
    "whisper-base": ("asr-models/sherpa-onnx-whisper-base.tar.bz2", True),
    "whisper-small": ("asr-models/sherpa-onnx-whisper-small.tar.bz2", True),
    "whisper-medium": ("asr-models/sherpa-onnx-whisper-medium.tar.bz2", True),
    "whisper-turbo": ("asr-models/sherpa-onnx-whisper-turbo.tar.bz2", True),
    "spleeter": ("source-separation-models/sherpa-onnx-spleeter-2stems-fp16.tar.bz2", True),
    "uvr": ("source-separation-models/UVR_MDXNET_Main.onnx", False),
    # Voces en castellano para generar los packs de prueba
    "tts-davefx": ("tts-models/vits-piper-es_ES-davefx-medium.tar.bz2", True),
    "tts-sharvard": ("tts-models/vits-piper-es_ES-sharvard-medium.tar.bz2", True),
    "tts-carlfm": ("tts-models/vits-piper-es_ES-carlfm-x_low.tar.bz2", True),
    "tts-ald": ("tts-models/vits-piper-es_MX-ald-medium.tar.bz2", True),
}


def carpeta_modelos() -> Path:
    d = Path(os.environ.get("DUBGAME_MODELOS", Path.home() / ".dubgame" / "modelos"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def _destino(nombre: str) -> Path:
    ruta, es_tar = CATALOGO[nombre]
    archivo = ruta.split("/")[-1]
    if es_tar:
        return carpeta_modelos() / archivo.removesuffix(".tar.bz2")
    return carpeta_modelos() / archivo


def asegurar(nombre: str) -> Path:
    """Devuelve la ruta local del modelo, descargándolo si hace falta."""
    destino = _destino(nombre)
    if destino.exists():
        return destino
    ruta, es_tar = CATALOGO[nombre]
    url = f"{BASE}/{ruta}"
    informar("modelos", f"Descargando modelo {nombre}…")
    with tempfile.TemporaryDirectory(dir=carpeta_modelos()) as tmp:
        tmp_archivo = Path(tmp) / ruta.split("/")[-1]
        with urllib.request.urlopen(url) as resp, open(tmp_archivo, "wb") as f:
            shutil.copyfileobj(resp, f, length=1 << 20)
        if es_tar:
            with tarfile.open(tmp_archivo, "r:bz2") as tar:
                tar.extractall(tmp, filter="data")
            shutil.move(str(Path(tmp) / destino.name), destino)
        else:
            shutil.move(str(tmp_archivo), destino)
    return destino


def whisper(tam: str) -> dict[str, str]:
    d = asegurar(f"whisper-{tam}")
    pref = d.name.removeprefix("sherpa-onnx-whisper-")

    def elegir(parte: str) -> str:
        int8 = d / f"{pref}-{parte}.int8.onnx"
        return str(int8 if int8.exists() else d / f"{pref}-{parte}.onnx")

    return {
        "encoder": elegir("encoder"),
        "decoder": elegir("decoder"),
        "tokens": str(d / f"{pref}-tokens.txt"),
    }


def voz_tts(nombre: str) -> dict[str, str]:
    d = asegurar(f"tts-{nombre}")
    onnx = next(p for p in d.glob("*.onnx"))
    return {"model": str(onnx), "tokens": str(d / "tokens.txt"), "data_dir": str(d / "espeak-ng-data")}
