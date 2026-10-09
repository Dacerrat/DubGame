"""Combina VAD + diarización en líneas de diálogo (funciones puras, testeables)."""
from __future__ import annotations

from .analisis import Tramo


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
    Implementación vectorizada (Lance-Williams), apta para cientos de ventanas.
    """
    import numpy as np

    emb = np.asarray(emb, dtype=np.float64)
    total = len(emb)
    if total == 0:
        return []
    fiables = [i for i in range(total) if duraciones[i] >= dur_min]
    if len(fiables) < max(2, n or 2):
        fiables = list(range(total))
    m = len(fiables)
    sim = emb[fiables] @ emb[fiables].T
    np.fill_diagonal(sim, -np.inf)
    tam = np.ones(m)
    miembros: list[list[int]] = [[i] for i in fiables]
    activos = m
    objetivo = max(1, min(n, m)) if n else 1
    while activos > objetivo:
        k = int(np.argmax(sim))
        a, b = divmod(k, m)
        s = sim[a, b]
        if not np.isfinite(s) or (n is None and s < umbral):
            break
        fila = (tam[a] * sim[a] + tam[b] * sim[b]) / (tam[a] + tam[b])
        sim[a, :] = fila
        sim[:, a] = fila
        sim[a, a] = -np.inf
        sim[b, :] = -np.inf
        sim[:, b] = -np.inf
        tam[a] += tam[b]
        miembros[a] += miembros[b]
        miembros[b] = []
        activos -= 1

    grupos = [g for g in miembros if g]
    etiquetas = [-1] * total
    for g, ms in enumerate(grupos):
        for i in ms:
            etiquetas[i] = g
    centroides = [emb[ms].mean(axis=0) for ms in grupos]
    for i in range(total):
        if etiquetas[i] < 0:
            etiquetas[i] = int(np.argmax([emb[i] @ c for c in centroides]))
    return etiquetas
