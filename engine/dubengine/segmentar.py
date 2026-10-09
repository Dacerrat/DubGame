"""Combina VAD + diarización en líneas de diálogo (funciones puras, testeables)."""
from __future__ import annotations

from .analisis import Tramo


def _solape(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def _hablante_cercano(t: float, diar: list[Tramo]) -> int:
    if not diar:
        return 0
    return min(diar, key=lambda d: 0 if d.inicio <= t <= d.fin else min(abs(t - d.inicio), abs(t - d.fin))).hablante


def asignar_hablantes(voz: list[Tramo], diar: list[Tramo], trozo_min: float = 0.4) -> list[Tramo]:
    """Parte cada tramo de voz en los cambios de hablante y le asigna hablante."""
    piezas: list[Tramo] = []
    for v in voz:
        # Puntos de corte: bordes de diarización dentro del tramo
        dentro = sorted({p for d in diar for p in (d.inicio, d.fin) if v.inicio < p < v.fin})
        bordes = [v.inicio, *dentro, v.fin]
        subtramos: list[Tramo] = []
        for a, b in zip(bordes, bordes[1:]):
            votos: dict[int, float] = {}
            for d in diar:
                s = _solape(a, b, d.inicio, d.fin)
                if s > 0:
                    votos[d.hablante] = votos.get(d.hablante, 0.0) + s
            h = max(votos, key=votos.get) if votos else _hablante_cercano((a + b) / 2, diar)
            if subtramos and subtramos[-1].hablante == h:
                subtramos[-1].fin = b
            else:
                subtramos.append(Tramo(a, b, h))
        # Las piezas demasiado cortas se absorben en la vecina
        limpio: list[Tramo] = []
        for s in subtramos:
            if limpio and (s.dur < trozo_min or limpio[-1].dur < trozo_min):
                largo = limpio[-1] if limpio[-1].dur >= s.dur else s
                limpio[-1] = Tramo(limpio[-1].inicio, s.fin, largo.hablante)
            else:
                limpio.append(s)
        piezas.extend(limpio)
    return piezas


def construir_lineas(piezas: list[Tramo], pausa_union: float = 0.7, max_linea: float = 8.0,
                     min_descartar: float = 0.2) -> list[Tramo]:
    """Une piezas consecutivas del mismo hablante y divide las líneas demasiado largas.

    Primero se une y después se descarta: una palabra corta como "No." al
    principio de una frase se queda en su línea en vez de perderse.
    """
    lineas: list[Tramo] = []
    for p in sorted(piezas, key=lambda t: t.inicio):
        ult = lineas[-1] if lineas else None
        if (ult and ult.hablante == p.hablante and p.inicio - ult.fin < pausa_union
                and p.fin - ult.inicio <= max_linea):
            ult.fin = p.fin
        else:
            lineas.append(Tramo(p.inicio, p.fin, p.hablante))
    lineas = [l for l in lineas if l.dur >= min_descartar]
    final: list[Tramo] = []
    for l in lineas:
        if l.dur <= max_linea:
            final.append(l)
            continue
        n = int(l.dur // max_linea) + 1
        paso = l.dur / n
        for i in range(n):
            final.append(Tramo(l.inicio + i * paso, l.inicio + (i + 1) * paso, l.hablante))
    return final


def acolchar(lineas: list[Tramo], antes: float = 0.08, despues: float = 0.15, total: float | None = None) -> list[Tramo]:
    """Añade un pequeño margen a cada línea sin pisar a las vecinas."""
    out: list[Tramo] = []
    for i, l in enumerate(lineas):
        ini = l.inicio - antes
        fin = l.fin + despues
        if i > 0:
            ini = max(ini, (lineas[i - 1].fin + l.inicio) / 2)
        if i + 1 < len(lineas):
            fin = min(fin, (l.fin + lineas[i + 1].inicio) / 2)
        ini = max(0.0, ini)
        if total is not None:
            fin = min(total, fin)
        out.append(Tramo(round(ini, 3), round(fin, 3), l.hablante))
    return out


def renumerar_hablantes(lineas: list[Tramo]) -> list[Tramo]:
    """Hablantes numerados 0..n-1 por orden de aparición."""
    mapa: dict[int, int] = {}
    for l in lineas:
        if l.hablante not in mapa:
            mapa[l.hablante] = len(mapa)
    return [Tramo(l.inicio, l.fin, mapa[l.hablante]) for l in lineas]


def agrupar(emb, duraciones: list[float], n: int | None = None, umbral: float = 0.5,
            dur_min: float = 0.8) -> list[int]:
    """Clustering aglomerativo (enlace medio, similitud coseno) de los tramos.

    Solo los tramos de al menos `dur_min` segundos deciden los grupos; los cortos
    se asignan después al grupo más parecido. Con `n` se fuerza el número de
    hablantes; sin él, se deja de unir cuando la similitud media baja de `umbral`.
    """
    import numpy as np

    emb = np.asarray(emb, dtype=np.float64)
    total = len(emb)
    if total == 0:
        return []
    fiables = [i for i in range(total) if duraciones[i] >= dur_min]
    if len(fiables) < max(2, n or 2):
        fiables = list(range(total))
    grupos = [[i] for i in fiables]
    sim = emb @ emb.T

    def parecido(a: list[int], b: list[int]) -> float:
        return float(sim[np.ix_(a, b)].mean())

    objetivo = max(1, min(n, len(grupos))) if n else 1
    while len(grupos) > objetivo:
        mejor = None
        for a in range(len(grupos)):
            for b in range(a + 1, len(grupos)):
                s = parecido(grupos[a], grupos[b])
                if mejor is None or s > mejor[0]:
                    mejor = (s, a, b)
        s, a, b = mejor
        if n is None and s < umbral:
            break
        grupos[a] += grupos[b]
        del grupos[b]

    etiquetas = [-1] * total
    for g, miembros in enumerate(grupos):
        for i in miembros:
            etiquetas[i] = g
    centroides = [emb[m].mean(axis=0) for m in grupos]
    for i in range(total):
        if etiquetas[i] < 0:
            etiquetas[i] = int(np.argmax([emb[i] @ c for c in centroides]))
    return etiquetas
