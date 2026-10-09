"""Quién habla y cuándo, pensado para diálogos rápidos de película.

En una escena real los personajes se pisan o contestan sin pausa ("¿Por
ejemplo?" justo después de una frase del otro). Por eso no basta con cortar en
los silencios:

1. Se calculan huellas de voz (embeddings) en ventanas cortas solapadas y se
   agrupan por hablante: eso da un primer reparto aunque no haya pausas.
2. Cada tramo de voz se parte en las micro-pausas entre palabras.
3. Cada trozo se asigna por su propia huella de voz cuando la decisión es clara
   (aunque sea una sola palabra como "No."); si es dudosa, manda el reparto de
   las ventanas.

Las funciones reciben la función de embeddings como parámetro para poder
probarlas sin modelos.
"""
from __future__ import annotations

from typing import Callable

import numpy as np

from .analisis import Tramo
from .segmentar import agrupar

Embeddings = Callable[[list[Tramo]], np.ndarray]


def ventanas(tramos: list[Tramo], ancho: float = 0.6, paso: float = 0.15) -> list[tuple[float, float, int]]:
    """Ventanas solapadas (inicio, fin, índice de tramo). Los tramos cortos son una sola ventana."""
    out: list[tuple[float, float, int]] = []
    for k, t in enumerate(tramos):
        if t.dur <= ancho * 1.25:
            out.append((t.inicio, t.fin, k))
            continue
        s = t.inicio
        while s + ancho <= t.fin + 1e-6:
            out.append((s, s + ancho, k))
            s += paso
        if out[-1][1] < t.fin - 0.05:
            out.append((t.fin - ancho, t.fin, k))
    return out


def etiquetas_por_votos(tramo: Tramo, ventanas_tramo: list[tuple[float, float, int]],
                        n_grupos: int, paso: float = 0.05, min_trozo: float = 0.3) -> list[Tramo]:
    """Parte un tramo según el grupo que más votan las ventanas que cubren cada instante."""
    n = max(1, int(round(tramo.dur / paso)))
    votos = np.zeros((n, max(1, n_grupos)))
    for a, b, g in ventanas_tramo:
        i0 = max(0, int((a - tramo.inicio) / paso))
        i1 = min(n, int(np.ceil((b - tramo.inicio) / paso)))
        votos[i0:i1, g] += 1
    et = votos.argmax(1)
    cambios = [0] + [i for i in range(1, n) if et[i] != et[i - 1]] + [n]
    trozos = [(cambios[i], cambios[i + 1], int(et[cambios[i]])) for i in range(len(cambios) - 1)]
    limpio: list[tuple[int, int, int]] = []
    for a, b, g in trozos:
        if limpio and ((b - a) * paso < min_trozo or limpio[-1][2] == g):
            pa, pb, pg = limpio[-1]
            limpio[-1] = (pa, b, pg if (pb - pa) >= (b - a) else g)
        else:
            limpio.append((a, b, g))
    return [Tramo(tramo.inicio + a * paso, min(tramo.fin, tramo.inicio + b * paso), g) for a, b, g in limpio]


def cortes_en_valles(env: np.ndarray, inicio: float, paso: float = 0.01, rel_db: float = -20,
                     min_dur: float = 0.04) -> list[float]:
    """Instantes de micro-pausa (mínimos de energía) dentro de un tramo de voz."""
    n = len(env)
    if n < 5:
        return []
    env = np.convolve(env, np.ones(3) / 3, mode="same")
    umbral = np.percentile(env, 90) * 10 ** (rel_db / 20)
    bajo = env < umbral
    cortes: list[float] = []
    k = 0
    while k < n:
        if not bajo[k]:
            k += 1
            continue
        j = k
        while j < n and bajo[j]:
            j += 1
        if (j - k) * paso >= min_dur and k > 0 and j < n:
            cortes.append(inicio + (k + int(np.argmin(env[k:j]))) * paso)
        k = j
    return cortes


def envolvente(voz: np.ndarray, sr: int, t: Tramo, paso: float = 0.01) -> np.ndarray:
    a, b = int(t.inicio * sr), int(t.fin * sr)
    x = voz[a:b]
    m = int(paso * sr)
    n = len(x) // m
    if n == 0:
        return np.zeros(0)
    return np.sqrt(np.mean(x[:n * m].reshape(n, m) ** 2, axis=1))


def agrupar_robusto(emb: np.ndarray, duraciones: list[float], n: int | None, umbral: float = 0.5,
                    extra: int = 3, dur_min: float = 0.5) -> list[int]:
    """Agrupa por voz sin que un puñado de ventanas raras se quede con un "hablante".

    - Con `n` conocido: se agrupa en n + `extra` grupos y se absorben los más
      pequeños (por segundos de voz) en el más parecido hasta quedar n.
    - Sin `n`: se agrupa por umbral y se absorben las "voces" con muy poco tiempo.
    Al final cada elemento va al centroide más parecido. Etiquetas por orden de aparición.
    """
    e = np.asarray(emb, dtype=np.float64)
    total = len(e)
    if total == 0:
        return []
    usables = [i for i in range(total) if duraciones[i] >= dur_min] or list(range(total))
    objetivo = n + extra if n else None
    sub = agrupar(e[usables], [duraciones[i] for i in usables], objetivo, umbral=umbral, dur_min=0)
    grupos: dict[int, list[int]] = {}
    for i, g in zip(usables, sub):
        grupos.setdefault(g, []).append(i)

    def centroide(ms: list[int]) -> np.ndarray:
        c = e[ms].mean(axis=0)
        return c / (np.linalg.norm(c) + 1e-9)

    voz_total = sum(duraciones[i] for i in usables)
    while len(grupos) > 1:
        segundos = {g: sum(duraciones[i] for i in ms) for g, ms in grupos.items()}
        menor = min(segundos, key=segundos.get)
        if n is not None and len(grupos) <= n:
            break
        if n is None and segundos[menor] >= max(2.0, 0.05 * voz_total):
            break
        cs = {g: centroide(ms) for g, ms in grupos.items()}
        destino = max((g for g in grupos if g != menor), key=lambda g: float(cs[menor] @ cs[g]))
        grupos[destino] += grupos.pop(menor)

    cs = {g: centroide(ms) for g, ms in grupos.items()}
    asignado = [max(cs, key=lambda g: float(e[i] @ cs[g])) for i in range(total)]
    orden: dict[int, int] = {}
    for g in asignado:
        orden.setdefault(g, len(orden))
    return [orden[g] for g in asignado]


def estimar_hablantes(tramos: list[Tramo], embeddings: Embeddings, umbral: float = 0.5) -> int:
    """Cuántas voces hay (cuando no lo dice la receta), con los tramos largos."""
    largos = [t for t in tramos if t.dur >= 0.8] or tramos
    if len(largos) < 2:
        return 1
    etiquetas = agrupar_robusto(embeddings(largos), [t.dur for t in largos], None, umbral=umbral, dur_min=0)
    return max(1, len(set(etiquetas)))


def diarizar(voz: np.ndarray, sr: int, tramos: list[Tramo], n: int | None, embeddings: Embeddings,
             margen: float = 0.12) -> list[Tramo]:
    """Devuelve trozos de voz con su hablante (0..n-1), en orden."""
    if not tramos:
        return []
    if n is None:
        n = estimar_hablantes(tramos, embeddings)
    if n <= 1:
        return [Tramo(t.inicio, t.fin, 0) for t in tramos]

    # 1) Reparto por ventanas
    vs = ventanas(tramos)
    ev = embeddings([Tramo(a, b) for a, b, _ in vs])
    grupos = agrupar_robusto(ev, [b - a for a, b, _ in vs], n)
    base: list[Tramo] = []
    for k, t in enumerate(tramos):
        propias = [(a, b, g) for (a, b, kk), g in zip(vs, grupos) if kk == k]
        base.extend(etiquetas_por_votos(t, propias, n))

    def por_ventanas(p: Tramo) -> int:
        votos: dict[int, float] = {}
        for q in base:
            o = min(p.fin, q.fin) - max(p.inicio, q.inicio)
            if o > 0:
                votos[q.hablante] = votos.get(q.hablante, 0.0) + o
        return max(votos, key=votos.get) if votos else 0

    # 2) Trozos entre micro-pausas
    piezas: list[Tramo] = []
    for t in tramos:
        bordes = [t.inicio, *cortes_en_valles(envolvente(voz, sr, t), t.inicio), t.fin]
        for a, b in zip(bordes, bordes[1:]):
            if piezas and b - a < 0.12 and abs(piezas[-1].fin - a) < 1e-6:
                piezas[-1].fin = b  # demasiado corto para ser una palabra
            else:
                piezas.append(Tramo(a, b, -1))
    for p in piezas:
        p.hablante = por_ventanas(p)

    # 3) Cada trozo por su propia voz si está claro
    ep = embeddings(piezas)
    for _ in range(2):
        centroides: dict[int, np.ndarray] = {}
        for h in {p.hablante for p in piezas}:
            idx = [i for i, p in enumerate(piezas) if p.hablante == h and p.dur >= 0.5] or \
                  [i for i, p in enumerate(piezas) if p.hablante == h]
            c = ep[idx].mean(axis=0)
            centroides[h] = c / (np.linalg.norm(c) + 1e-9)
        for i, p in enumerate(piezas):
            sims = sorted(((float(ep[i] @ c), h) for h, c in centroides.items()), reverse=True)
            if len(sims) > 1 and p.dur >= 0.25 and sims[0][0] - sims[1][0] >= margen:
                p.hablante = sims[0][1]
            else:
                p.hablante = por_ventanas(p)
    return piezas
