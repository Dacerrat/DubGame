"""Utilidades de audio/vídeo basadas en ffmpeg y numpy."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np


def ffmpeg() -> str:
    if os.environ.get("DUBGAME_FFMPEG"):
        return os.environ["DUBGAME_FFMPEG"]
    sistema = shutil.which("ffmpeg")
    if sistema:
        return sistema
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def ejecutar(args: list[str]) -> None:
    proc = subprocess.run([ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", *args],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg falló: {proc.stderr.strip()[-800:]}")


def leer(ruta: str | Path, sr: int, canales: int = 1, inicio: float | None = None,
         fin: float | None = None) -> np.ndarray:
    """Decodifica a float32. Devuelve (n,) si mono o (canales, n) si no."""
    args = [ffmpeg(), "-hide_banner", "-loglevel", "error"]
    if inicio is not None:
        args += ["-ss", f"{inicio:.3f}"]
    if fin is not None:
        args += ["-to", f"{fin:.3f}"]
    args += ["-i", str(ruta), "-vn", "-ac", str(canales), "-ar", str(sr), "-f", "f32le", "-"]
    proc = subprocess.run(args, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"No se pudo leer el audio de {ruta}: {proc.stderr.decode()[-500:]}")
    datos = np.frombuffer(proc.stdout, dtype=np.float32)
    if canales == 1:
        return datos.copy()
    return datos.reshape(-1, canales).T.copy()


def escribir_wav(ruta: str | Path, datos: np.ndarray, sr: int) -> None:
    """Escribe WAV PCM 16 bits. `datos` es (n,) o (canales, n)."""
    import wave

    if datos.ndim == 1:
        datos = datos[None, :]
    pcm = (np.clip(datos.T, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(ruta), "wb") as w:
        w.setnchannels(datos.shape[0])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def a_mp3(origen: str | Path, destino: str | Path, kbps: int = 160) -> None:
    """MP3: lo decodifican todos los navegadores (AAC no está en Chromium libre)."""
    ejecutar(["-i", str(origen), "-vn", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", str(destino)])


def duracion(ruta: str | Path) -> float:
    """Duración en segundos usando ffmpeg (sin depender de ffprobe)."""
    proc = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(ruta)], capture_output=True, text=True)
    for linea in proc.stderr.splitlines():
        linea = linea.strip()
        if linea.startswith("Duration:"):
            h, m, s = linea.split(",")[0].split()[1].split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise RuntimeError(f"No se pudo obtener la duración de {ruta}")


def tiene_video(ruta: str | Path) -> bool:
    proc = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(ruta)], capture_output=True, text=True)
    return any("Video:" in l and "attached pic" not in l for l in proc.stderr.splitlines())


def rms_db(x: np.ndarray) -> float:
    if x.size == 0:
        return -120.0
    return float(20 * np.log10(np.sqrt(np.mean(np.square(x, dtype=np.float64))) + 1e-12))


def guardar_json(ruta: str | Path, datos: dict) -> None:
    Path(ruta).write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
