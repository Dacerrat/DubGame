import numpy as np

from dubengine.analisis import Tramo
from dubengine.segmentar import acolchar, agrupar, construir_lineas, renumerar_hablantes


def test_une_mismo_hablante_y_corta_largas():
    piezas = [Tramo(0, 2, 0), Tramo(2.3, 4, 0), Tramo(5.5, 7, 0), Tramo(7.2, 9, 1)]
    lineas = construir_lineas(piezas, pausa_union=0.7, max_linea=8)
    assert [(l.inicio, l.fin, l.hablante) for l in lineas] == [(0, 4, 0), (5.5, 7, 0), (7.2, 9, 1)]
    largas = construir_lineas([Tramo(0, 20, 0)], max_linea=8)
    assert len(largas) == 3 and all(l.dur <= 8 for l in largas)


def test_acolchar_no_pisa_vecinas():
    l = acolchar([Tramo(1.0, 2.0, 0), Tramo(2.1, 3.0, 1)], antes=0.1, despues=0.2, total=3.1)
    assert l[0].fin <= l[1].inicio
    assert l[1].fin <= 3.1


def test_renumera_por_aparicion():
    l = renumerar_hablantes([Tramo(0, 1, 5), Tramo(1, 2, 2), Tramo(2, 3, 5)])
    assert [x.hablante for x in l] == [0, 1, 0]


def _emb(rng, centro, n):
    x = centro + 0.15 * rng.standard_normal((n, len(centro)))
    return x / np.linalg.norm(x, axis=1, keepdims=True)


def test_agrupar_con_y_sin_numero_de_hablantes():
    rng = np.random.default_rng(0)
    centros = np.eye(3, 16)
    emb = np.vstack([_emb(rng, c, 4) for c in centros])
    verdad = [0] * 4 + [1] * 4 + [2] * 4
    orden = rng.permutation(12)
    emb, verdad = emb[orden], [verdad[i] for i in orden]
    for n in (3, None):
        etiquetas = agrupar(emb, [2.0] * 12, n)
        # Misma partición (salvo renombrado)
        pares = {(e, v) for e, v in zip(etiquetas, verdad)}
        assert len(pares) == 3 and len(set(etiquetas)) == 3


def test_agrupar_tramos_cortos_van_al_grupo_mas_parecido():
    rng = np.random.default_rng(1)
    a, b = np.eye(2, 8)
    emb = np.vstack([_emb(rng, a, 3), _emb(rng, b, 3), _emb(rng, b, 1)])
    etiquetas = agrupar(emb, [2, 2, 2, 2, 2, 2, 0.3], 2)
    assert etiquetas[6] == etiquetas[3]


def test_palabra_corta_al_principio_no_se_pierde():
    # "No." (0,18 s), pausa de 0,3 s y el resto de la frase, del mismo hablante
    piezas = [Tramo(9.68, 9.86, 0), Tramo(10.16, 12.3, 0), Tramo(13.0, 13.1, 1)]
    lineas = construir_lineas(piezas)
    assert [(l.inicio, l.fin, l.hablante) for l in lineas] == [(9.68, 12.3, 0)]


def test_lineas_largas_se_cortan_en_la_pausa_mayor():
    # Frase 1 (0-5 s) y frase 2 (5.4-9 s) del mismo hablante, con micro-pausas internas
    piezas = [Tramo(0, 2.5, 0), Tramo(2.7, 5.0, 0), Tramo(5.4, 5.8, 0), Tramo(5.95, 9.0, 0)]
    lineas = construir_lineas(piezas, max_linea=8.0)
    assert [(l.inicio, l.fin) for l in lineas] == [(0, 5.0), (5.4, 9.0)]


def test_mismo_hablante_varias_frases_seguidas_es_una_linea():
    # Tres frases del mismo personaje con pausas de hasta ~0,9 s: no se corta
    piezas = [Tramo(0, 1.5, 0), Tramo(2.2, 3.4, 0), Tramo(4.3, 6.0, 0), Tramo(6.4, 7.0, 1)]
    lineas = construir_lineas(piezas)
    assert [(l.inicio, l.fin, l.hablante) for l in lineas] == [(0, 6.0, 0), (6.4, 7.0, 1)]
