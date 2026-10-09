"""Separación voz / fondo (música y efectos)."""
from __future__ import annotations

import numpy as np

from . import modelos
from .progreso import informar

SR = 44100


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))


def separar(estereo: np.ndarray, metodo: str = "uvr", hilos: int = 4) -> tuple[np.ndarray, np.ndarray]:
    """Recibe (2, n) a 44.1 kHz y devuelve (voces, fondo), ambos (2, n).

    metodo: "uvr" (por defecto: separa muy bien y respeta el volumen del fondo),
    "spleeter" (rápido, pero inestable en algunos audios) o "ninguno".
    """
    if metodo == "ninguno":
        return estereo.copy(), np.zeros_like(estereo)

    import sherpa_onnx

    if metodo == "uvr":
        modelo = sherpa_onnx.OfflineSourceSeparationModelConfig(
            uvr=sherpa_onnx.OfflineSourceSeparationUvrModelConfig(model=str(modelos.asegurar("uvr"))),
            num_threads=hilos)
    else:
        d = modelos.asegurar("spleeter")
        modelo = sherpa_onnx.OfflineSourceSeparationModelConfig(
            spleeter=sherpa_onnx.OfflineSourceSeparationSpleeterModelConfig(
                vocals=str(d / "vocals.fp16.onnx"), accompaniment=str(d / "accompaniment.fp16.onnx")),
            num_threads=hilos)
    sep = sherpa_onnx.OfflineSourceSeparation(sherpa_onnx.OfflineSourceSeparationConfig(model=modelo))

    n = estereo.shape[1]
    trozo = SR * 60  # se procesa por minutos para acotar memoria
    voces = np.zeros_like(estereo)
    fondo = np.zeros_like(estereo)
    for i in range(0, n, trozo):
        informar("separar", "Separando voces del fondo…", i / n)
        bloque = np.ascontiguousarray(estereo[:, i:i + trozo])
        salida = sep.process(SR, bloque)
        for destino, stem in ((voces, salida.stems[0]), (fondo, salida.stems[1])):
            datos = np.asarray(stem.data, dtype=np.float32)
            if datos.ndim == 1:
                datos = np.stack([datos, datos])
            largo = min(datos.shape[1], bloque.shape[1])
            destino[:, i:i + largo] = datos[:, :largo]
    # Spleeter a veces "explota": dos pistas enormes que solo se anulan al sumarse.
    # Si pasa, se repite con UVR, que es estable.
    if metodo == "spleeter" and max(_rms(voces), _rms(fondo)) > 2 * _rms(estereo) + 1e-3:
        informar("separar", "Spleeter ha fallado con este audio; se repite con UVR…")
        return separar(estereo, "uvr", hilos)
    return voces, fondo
