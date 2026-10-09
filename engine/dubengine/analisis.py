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


def vad(voz: np.ndarray, silencio_min: float = 0.25, habla_min: float = 0.2) -> list[Tramo]:
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


def diarizar(voz: np.ndarray, n_hablantes: int | None, umbral: float = 0.4, hilos: int = 4) -> list[Tramo]:
    import sherpa_onnx

    informar("diarizar", "Identificando quién habla en cada momento…")
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=str(modelos.asegurar("segmentacion") / "model.onnx")),
            num_threads=hilos),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(modelos.asegurar("embedding")), num_threads=hilos),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=n_hablantes if n_hablantes else -1, threshold=umbral),
        min_duration_on=0.2,
        min_duration_off=0.3,
    )
    if not config.validate():
        raise RuntimeError("Configuración de diarización no válida")
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    if n_hablantes == 1:
        return [Tramo(0.0, len(voz) / SR, 0)]
    res = sd.process(voz).sort_by_start_time()
    return [Tramo(s.start, s.end, s.speaker) for s in res]


def embeddings(voz: np.ndarray, tramos: list[Tramo], hilos: int = 4) -> np.ndarray:
    """Un embedding de voz (normalizado) por tramo."""
    import sherpa_onnx

    ext = sherpa_onnx.SpeakerEmbeddingExtractor(
        sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(modelos.asegurar("embedding")), num_threads=hilos))
    salida = []
    for t in tramos:
        trozo = voz[int(t.inicio * SR):int(t.fin * SR)]
        if len(trozo) < int(0.3 * SR):  # demasiado corto: se rellena repitiéndolo
            trozo = np.tile(trozo, int(np.ceil(0.3 * SR / max(1, len(trozo)))))
        s = ext.create_stream()
        s.accept_waveform(SR, trozo)
        s.input_finished()
        e = np.asarray(ext.compute(s), dtype=np.float32)
        salida.append(e / (np.linalg.norm(e) + 1e-9))
    return np.array(salida)


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
