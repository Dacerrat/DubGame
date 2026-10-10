"""VAD, diarización y transcripción con sherpa-onnx (todo a 16 kHz mono)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import modelos
from .progreso import informar

SR = 16000


@dataclass
class Tramo:
    inicio: float
    fin: float
    hablante: int = -1

    @property
    def dur(self) -> float:
        return self.fin - self.inicio


def vad(voz: np.ndarray, silencio_min: float = 0.25, habla_min: float = 0.12) -> list[Tramo]:
    import sherpa_onnx

    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(modelos.asegurar("vad"))
    config.silero_vad.threshold = 0.45
    config.silero_vad.min_silence_duration = silencio_min
    config.silero_vad.min_speech_duration = habla_min
    config.silero_vad.max_speech_duration = 20
    config.sample_rate = SR
    det = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=max(30, len(voz) / SR + 5))
    ventana = config.silero_vad.window_size
    tramos: list[Tramo] = []

    def vaciar() -> None:
        while not det.empty():
            seg = det.front
            ini = seg.start / SR
            tramos.append(Tramo(ini, ini + len(seg.samples) / SR))
            det.pop()

    for i in range(0, len(voz), ventana):
        det.accept_waveform(voz[i:i + ventana])
        vaciar()
    det.flush()
    vaciar()
    return tramos


# Modelos de huellas de voz (nombre en modelos.CATALOGO, duración mínima en s: los
# trozos más cortos se repiten hasta llegar). CAM++ clasifica mejor los trozos
# cortos repetidos hasta 1 s; TitaNet, con 0,3 s.
HUELLAS: tuple[tuple[str, float], ...] = (("embedding", 1.0), ("embedding-titanet", 0.3))
_extractores: dict = {}


def _extractor(nombre: str, hilos: int):
    """Cada modelo se carga una sola vez (diarizar pide huellas varias veces por clip)."""
    import sherpa_onnx

    clave = (nombre, hilos)
    if clave not in _extractores:
        _extractores[clave] = sherpa_onnx.SpeakerEmbeddingExtractor(
            sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(modelos.asegurar(nombre)), num_threads=hilos))
    return _extractores[clave]


def embeddings(voz: np.ndarray, tramos: list[Tramo], hilos: int = 4,
               huellas: tuple[tuple[str, float], ...] = HUELLAS) -> np.ndarray:
    """Una huella de voz (normalizada) por tramo.

    Con varios modelos se concatenan sus huellas normalizadas, cada una escalada por
    1/sqrt(k): el producto escalar de dos huellas es la media de los cosenos de los
    k modelos, y la diarización no necesita saber cuántos hay.
    """
    bloques = []
    for nombre, minimo in huellas:
        ext = _extractor(nombre, hilos)
        bloque = np.zeros((len(tramos), ext.dim), dtype=np.float32)
        for i, t in enumerate(tramos):
            trozo = voz[int(t.inicio * SR):int(t.fin * SR)]
            if len(trozo) < int(minimo * SR):  # demasiado corto: se rellena repitiéndolo
                trozo = np.tile(trozo, int(np.ceil(minimo * SR / max(1, len(trozo)))))
            s = ext.create_stream()
            s.accept_waveform(SR, trozo)
            s.input_finished()
            e = np.asarray(ext.compute(s), dtype=np.float32)
            bloque[i] = e / (np.linalg.norm(e) + 1e-9)
        bloques.append(bloque / np.sqrt(len(huellas)))
    e = np.concatenate(bloques, axis=1)
    return e / (np.linalg.norm(e, axis=1, keepdims=True) + 1e-9)


class Transcriptor:
    def __init__(self, tam: str = "small", idioma: str = "es", hilos: int = 4):
        import sherpa_onnx

        rutas = modelos.whisper(tam)
        self.rec = sherpa_onnx.OfflineRecognizer.from_whisper(
            encoder=rutas["encoder"], decoder=rutas["decoder"], tokens=rutas["tokens"],
            language="" if idioma == "auto" else idioma, task="transcribe", num_threads=hilos)

    def transcribir(self, voz: np.ndarray) -> str:
        # Whisper funciona mejor con un poco de margen de silencio.
        margen = np.zeros(int(0.3 * SR), dtype=np.float32)
        stream = self.rec.create_stream()
        stream.accept_waveform(SR, np.concatenate([margen, voz, margen]))
        self.rec.decode_stream(stream)
        return stream.result.text.strip()
