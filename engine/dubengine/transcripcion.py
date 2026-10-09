"""Transcripción con contexto y filtrado de lo que no es voz.

Whisper se equivoca mucho con frases sueltas de un segundo ("¿Qué llaves?" ->
"Te llamas"), pero acierta casi todo si oye la conversación entera. Como los
modelos disponibles no dan marcas de tiempo por palabra, se hace así:

1. Cada línea se transcribe sola con un modelo rápido: sirve de guía.
2. Cada bloque de líneas seguidas se transcribe de una vez con el modelo bueno.
3. El texto del bloque se reparte entre sus líneas buscando el corte que mejor
   encaja con las guías, las duraciones y la puntuación (programación dinámica).
"""
from __future__ import annotations

import re

from .alinear import duracion_esperada, normalizar, similitud

# Lo que Whisper escribe cuando no hay voz (o se lo inventa en silencios)
_NO_VOZ = re.compile(
    r"^\W*$|^[\[(¡¿]*\s*(m[uú]sica|music|risas?|aplausos|silencio|ruido|suspira|grita|gemido|tos)\s*[\])!?.]*$"
    r"|♪|subt[ií]tul|amara\.org|suscr[ií]bete|gracias por ver|gracias por su atenci[oó]n",
    re.IGNORECASE)


# Frases que Whisper suele inventarse en silencios o ruidos flojos
_ALUCINACIONES = {
    "gracias", "muchas gracias", "gracias por ver", "gracias por ver el video", "gracias por vernos",
    "suscribete", "hasta luego", "adios", "un saludo", "bye", "amen", "chao", "hola", "eh", "mmm", "ah", "oh",
}


def es_alucinacion(texto: str) -> bool:
    return normalizar(texto) in _ALUCINACIONES


def es_no_voz(texto: str) -> bool:
    t = texto.strip()
    if not t or not normalizar(t):
        return True
    if re.fullmatch(r"\s*[\[(].*[\])]\s*", t):  # [Música], (risas)…
        return True
    return bool(_NO_VOZ.search(t))


def limpiar(texto: str) -> str:
    """Quita los guiones de diálogo de Whisper ("- Sí. - No.") y espacios sobrantes."""
    t = re.sub(r"(^|\s)[-–—]+\s*", " ", texto)
    return re.sub(r"\s+", " ", t).strip()


def bloques(lineas: list[tuple[float, float]], max_hueco: float = 1.2, max_dur: float = 24.0) -> list[list[int]]:
    """Agrupa líneas seguidas (huecos cortos) en bloques que caben en una ventana de Whisper."""
    out: list[list[int]] = []
    for i, (ini, fin) in enumerate(lineas):
        if out:
            b = out[-1]
            if ini - lineas[b[-1]][1] <= max_hueco and fin - lineas[b[0]][0] <= max_dur:
                b.append(i)
                continue
        out.append([i])
    return out


def repartir(texto: str, guias: list[str], duraciones: list[float]) -> list[str] | None:
    """Reparte las palabras de `texto` en len(guias) grupos seguidos (uno por línea).

    Devuelve None si no hay un reparto convincente (y entonces se usan las guías).
    """
    palabras = limpiar(texto).split()
    m, n = len(guias), len(palabras)
    if m == 0 or n < m:
        return None
    if m == 1:
        return [" ".join(palabras)]
    max_pal = [max(2, int(d * 6) + 8) for d in duraciones]
    fin_frase = [bool(re.search(r"[.?!…]$", w)) for w in palabras]
    inicio_frase = [bool(re.match(r"^[¿¡]", w)) for w in palabras]

    NEG = float("-inf")
    SALTO = -0.35  # coste de dejar una palabra fuera (red de seguridad)
    # Palabras que caben en cada línea (~3 por segundo, con margen)
    caben = [max(2.0, d * 3.2) + 2 for d in duraciones]
    mejor = [[NEG] * (n + 1) for _ in range(m + 1)]
    previo = [[-1] * (n + 1) for _ in range(m + 1)]
    mejor[0][0] = 0.0
    for i in range(m + 1):
        for j in range(n + 1):
            if mejor[i][j] == NEG:
                continue
            # saltar la palabra j
            if j < n and mejor[i][j] + SALTO > mejor[i][j + 1]:
                mejor[i][j + 1] = mejor[i][j] + SALTO
                previo[i][j + 1] = -2 - j  # marca de salto
            if i == m:
                continue
            guia = guias[i]
            # deja al menos una palabra para cada línea que falta
            for k in range(j + 1, min(n - (m - i - 1), j + max_pal[i]) + 1):
                grupo = " ".join(palabras[j:k])
                s = similitud(grupo, guia) if normalizar(guia) else 0.3
                r = max(0.05, duraciones[i]) / duracion_esperada(grupo)
                s += 0.25 * min(r, 1 / r)
                if k < n:
                    s += 0.15 * fin_frase[k - 1] + 0.1 * inicio_frase[k]
                s -= 0.3 * max(0.0, (k - j) - caben[i])  # demasiadas palabras para su duración
                if j > 0 and fin_frase[j - 1]:
                    s += 0.2  # la línea empieza donde empieza una frase
                v = mejor[i][j] + s
                if v > mejor[i + 1][k]:
                    mejor[i + 1][k] = v
                    previo[i + 1][k] = j
    if mejor[m][n] == NEG:
        return None
    grupos = [""] * m
    i, k = m, n
    while i > 0 or k > 0:
        j = previo[i][k]
        if j <= -2:  # palabra saltada
            k -= 1
            continue
        grupos[i - 1] = " ".join(palabras[j:k])
        i, k = i - 1, j
    con_guia = [(g, gu) for g, gu in zip(grupos, guias) if normalizar(gu)]
    if con_guia and sum(similitud(g, gu) for g, gu in con_guia) / len(con_guia) < 0.35:
        return None
    return grupos
