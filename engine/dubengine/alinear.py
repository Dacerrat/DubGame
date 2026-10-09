"""Alinea el guion de una receta con las líneas detectadas en el audio.

- Mismo idioma: por similitud de texto entre el guion y la transcripción.
- Otro idioma: por duración plausible de cada línea y coherencia de hablante
  (secuencia de turnos), con programación dinámica monótona.
"""
from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher


@dataclass
class Detectada:
    inicio: float
    fin: float
    hablante: int
    texto: str = ""

    @property
    def dur(self) -> float:
        return self.fin - self.inicio


@dataclass
class LineaGuion:
    personaje: str
    texto: str


@dataclass
class Alineada:
    personaje: str
    texto: str
    inicio: float
    fin: float
    confianza: float
    texto_original: str = ""
    hablantes: list[int] = field(default_factory=list)


def normalizar(t: str) -> str:
    t = unicodedata.normalize("NFD", t.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def similitud(a: str, b: str) -> float:
    a, b = normalizar(a), normalizar(b)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b, autojunk=False).ratio()


def duracion_esperada(texto: str) -> float:
    """Segundos aproximados que se tarda en decir el texto en castellano."""
    return max(0.6, len(normalizar(texto)) / 14.0 + 0.2)


def plausibilidad_duracion(texto: str, dur: float) -> float:
    r = max(dur, 0.05) / duracion_esperada(texto)
    return math.exp(-(math.log(r) ** 2) / (2 * 0.55 ** 2))


# (lineas de guion, lineas detectadas) que puede consumir un emparejamiento
FORMAS = [(1, 1), (1, 2), (1, 3), (2, 1), (3, 1)]


def _dp(guion: list[LineaGuion], det: list[Detectada], mismo_idioma: bool,
        mapa: dict[int, str] | None) -> list[tuple[str, int, int, int, int, float]]:
    n, m = len(guion), len(det)
    NEG = -1e9
    mejor = [[NEG] * (m + 1) for _ in range(n + 1)]
    previo: list[list[tuple | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    mejor[0][0] = 0.0
    salto_guion = -0.35
    salto_det = -0.12

    def puntuar(i: int, a: int, j: int, b: int) -> float:
        g = guion[i:i + a]
        d = det[j:j + b]
        texto_g = " ".join(x.texto for x in g)
        dur = d[-1].fin - d[0].inicio
        if mismo_idioma:
            s = similitud(texto_g, " ".join(x.texto for x in d))
            s = 0.85 * s + 0.15 * plausibilidad_duracion(texto_g, dur)
        else:
            s = plausibilidad_duracion(texto_g, dur)
        if mapa is not None:
            pares = [(x, y) for x in g for y in d]
            coherencia = sum(1 for x, y in pares if mapa.get(y.hablante) == x.personaje) / len(pares)
            peso = 0.3 if mismo_idioma else 0.55
            s = (1 - peso) * s + peso * coherencia
        # Penalización suave por fusionar/partir
        s -= 0.12 * (a - 1 + b - 1)
        return s

    base = 0.35 if mismo_idioma else 0.25
    for i in range(n + 1):
        for j in range(m + 1):
            v = mejor[i][j]
            if v <= NEG / 2:
                continue
            if i < n and v + salto_guion > mejor[i + 1][j]:
                mejor[i + 1][j] = v + salto_guion
                previo[i + 1][j] = ("g", i, j, 1, 0, 0.0)
            if j < m and v + salto_det > mejor[i][j + 1]:
                mejor[i][j + 1] = v + salto_det
                previo[i][j + 1] = ("d", i, j, 0, 1, 0.0)
            for a, b in FORMAS:
                if i + a <= n and j + b <= m:
                    s = puntuar(i, a, j, b)
                    nv = v + (s - base)
                    if nv > mejor[i + a][j + b]:
                        mejor[i + a][j + b] = nv
                        previo[i + a][j + b] = ("m", i, j, a, b, s)
    pasos = []
    i, j = n, m
    while (i, j) != (0, 0):
        p = previo[i][j]
        assert p is not None
        pasos.append(p)
        i, j = p[1], p[2]
    pasos.reverse()
    return pasos


def _mapa_hablantes(guion: list[LineaGuion], det: list[Detectada], pasos) -> dict[int, str]:
    votos: dict[int, dict[str, float]] = {}
    for tipo, i, j, a, b, s in pasos:
        if tipo != "m":
            continue
        for x in det[j:j + b]:
            for g in guion[i:i + a]:
                votos.setdefault(x.hablante, {}).setdefault(g.personaje, 0.0)
                votos[x.hablante][g.personaje] += max(s, 0.05) * x.dur / a
    # Asignación voraz por peso, un personaje por hablante cuando sea posible
    pares = sorted(((w, h, p) for h, ps in votos.items() for p, w in ps.items()), reverse=True)
    mapa: dict[int, str] = {}
    usados: set[str] = set()
    for w, h, p in pares:
        if h not in mapa and p not in usados:
            mapa[h] = p
            usados.add(p)
    for h, ps in votos.items():
        if h not in mapa:
            mapa[h] = max(ps, key=ps.get)
    return mapa


def alinear(guion: list[LineaGuion], det: list[Detectada], mismo_idioma: bool) -> tuple[list[Alineada], list[Detectada]]:
    """Devuelve (líneas alineadas en orden de guion, detectadas sin usar)."""
    pasos = _dp(guion, det, mismo_idioma, None)
    mapa = _mapa_hablantes(guion, det, pasos)
    pasos = _dp(guion, det, mismo_idioma, mapa)

    salida: list[Alineada | None] = [None] * len(guion)
    sobrantes: list[Detectada] = []
    for tipo, i, j, a, b, s in pasos:
        if tipo == "d":
            sobrantes.append(det[j])
        elif tipo == "m":
            d = det[j:j + b]
            ini, fin = d[0].inicio, d[-1].fin
            original = " ".join(x.texto for x in d).strip()
            if a == 1:
                salida[i] = Alineada(guion[i].personaje, guion[i].texto, ini, fin, s, original,
                                     [x.hablante for x in d])
            else:
                # Varias líneas de guion en un solo tramo: se reparte por longitud de texto
                pesos = [max(1, len(normalizar(g.texto))) for g in guion[i:i + a]]
                total = sum(pesos)
                t = ini
                for k, g in enumerate(guion[i:i + a]):
                    tf = fin if k == a - 1 else t + (fin - ini) * pesos[k] / total
                    salida[i + k] = Alineada(g.personaje, g.texto, round(t, 3), round(tf, 3), s * 0.8,
                                             original if k == 0 else "", [x.hablante for x in d])
                    t = tf
    # Líneas de guion no encontradas: se colocan en el hueco entre vecinas
    for i, linea in enumerate(salida):
        if linea is not None:
            continue
        prev_fin = next((salida[k].fin for k in range(i - 1, -1, -1) if salida[k]), 0.0)
        sig_ini = next((salida[k].inicio for k in range(i + 1, len(salida)) if salida[k]), prev_fin + duracion_esperada(guion[i].texto) + 0.4)
        dur = min(duracion_esperada(guion[i].texto), max(0.5, sig_ini - prev_fin - 0.2))
        ini = prev_fin + 0.1
        salida[i] = Alineada(guion[i].personaje, guion[i].texto, round(ini, 3), round(ini + dur, 3), 0.0)
    return [s for s in salida if s is not None], sobrantes


def lineas_desde_audio(guion: list[LineaGuion], det: list[Detectada],
                       umbral_texto: float = 0.8) -> tuple[list[Alineada], list[Detectada]]:
    """Variante para clips en el mismo idioma que el guion (castellano).

    Mandan las líneas detectadas en el audio: sus tiempos son los reales y nunca se
    reparten a ojo. El guion sirve para poner nombre a cada voz y, cuando su texto
    coincide de verdad con lo que se oye (similitud >= umbral_texto), para usar su
    texto limpio; si no coincide, se usa la transcripción, de modo que los
    subtítulos siempre corresponden al audio.
    """
    pasos = _dp(guion, det, True, None)
    mapa = _mapa_hablantes(guion, det, pasos)
    pasos = _dp(guion, det, True, mapa)
    mapa = _mapa_hablantes(guion, det, pasos)

    salida: list[Alineada] = []
    sobrantes: list[Detectada] = []
    for tipo, i, j, a, b, s in pasos:
        if tipo == "d":
            d = det[j]
            personaje = mapa.get(d.hablante)
            if personaje is None or not d.texto.strip():
                sobrantes.append(d)  # voz que no es de ningún personaje del guion
            else:
                salida.append(Alineada(personaje, d.texto, d.inicio, d.fin, 0.6, d.texto, [d.hablante]))
        elif tipo == "m":
            ds = det[j:j + b]
            gs = guion[i:i + a]
            texto_g = " ".join(g.texto for g in gs)
            texto_d = " ".join(x.texto for x in ds).strip()
            sim = similitud(texto_g, texto_d)
            texto = texto_g if sim >= umbral_texto or not texto_d else texto_d
            # Decide la voz: el guion solo sirve para saber qué voz es cada personaje
            # (votación sobre todo el clip), no para cambiar quién dice cada frase.
            personaje = mapa.get(max(ds, key=lambda x: x.dur).hablante, gs[0].personaje)
            salida.append(Alineada(personaje, texto, ds[0].inicio, ds[-1].fin, max(s, sim), texto_d,
                                   [x.hablante for x in ds]))
        # tipo "g": línea del guion que no está en el audio -> no hay nada que doblar
    salida.sort(key=lambda x: x.inicio)
    return salida, sobrantes
