import numpy as np

from dubengine.analisis import Tramo
from dubengine.diarizacion import agrupar_robusto, cortes_en_valles, diarizar, etiquetas_por_votos, revisar_lineas, ventanas

SR = 16000


def test_ventanas_cubren_los_tramos():
    vs = ventanas([Tramo(0, 0.5), Tramo(1, 3)], ancho=0.6, paso=0.15)
    assert vs[0] == (0, 0.5, 0)
    assert all(k == 1 for _, _, k in vs[1:])
    assert vs[1][0] == 1 and abs(vs[-1][1] - 3) < 1e-9


def test_votos_y_suavizado():
    t = Tramo(0, 2)
    vs = [(0, 0.6, 0), (0.3, 0.9, 0), (0.6, 1.2, 0), (1.0, 1.6, 1), (1.3, 1.9, 1), (1.4, 2.0, 1)]
    trozos = etiquetas_por_votos(t, vs, 2)
    assert [x.hablante for x in trozos] == [0, 1]
    assert 1.0 <= trozos[1].inicio <= 1.25


def test_cortes_en_valles():
    env = np.array([1.0] * 30 + [0.01] * 8 + [1.0] * 30)  # micro-pausa de 80 ms
    cortes = cortes_en_valles(env, inicio=2.0)
    assert len(cortes) == 1 and 2.29 <= cortes[0] <= 2.39


def _emb_falsos(centros, quien):
    rng = np.random.default_rng(3)
    x = np.array([centros[q] for q in quien]) + 0.2 * rng.standard_normal((len(quien), centros.shape[1]))
    return x / np.linalg.norm(x, axis=1, keepdims=True)


def test_agrupar_robusto_ignora_ventanas_raras():
    centros = np.eye(3, 16)
    # 40 ventanas de A, 30 de B y 2 "raras" (ruido)
    quien = [0] * 40 + [1] * 30
    e = _emb_falsos(centros, quien)
    raras = np.random.default_rng(9).standard_normal((2, 16))
    e = np.vstack([e, raras / np.linalg.norm(raras, axis=1, keepdims=True)])
    et = agrupar_robusto(e, [0.6] * len(e), 2)
    assert len(set(et[:40])) == 1 and len(set(et[40:70])) == 1 and et[0] != et[40]


def test_diarizar_separa_turnos_sin_pausa():
    """Dos voces que se contestan sin silencio entre ellas (un solo tramo de voz)."""
    centros = np.eye(2, 8)
    # Guion: A habla 0-2 s, B habla 2-2.4 s ("No."), A habla 2.4-4 s
    def quien_habla(t):
        return 1 if 2.0 <= t < 2.4 else 0

    def emb(trozos):
        out = []
        for tr in trozos:
            ts = np.linspace(tr.inicio, tr.fin, 20, endpoint=False)
            mezcla = np.mean([centros[quien_habla(t)] for t in ts], axis=0)
            out.append(mezcla / np.linalg.norm(mezcla))
        return np.array(out)

    # Voz con una micro-pausa entre turnos (como en el diálogo real)
    n = int(4 * SR)
    voz = np.sin(np.arange(n) * 0.05).astype(np.float32) * 0.5
    for a, b in ((1.97, 2.03), (2.37, 2.43)):
        voz[int(a * SR):int(b * SR)] *= 0.001
    piezas = diarizar(voz, SR, [Tramo(0, 4)], 2, emb)
    etiquetas_en = lambda t: next(p.hablante for p in piezas if p.inicio <= t < p.fin)
    assert etiquetas_en(1.0) == etiquetas_en(3.0)
    assert etiquetas_en(2.2) != etiquetas_en(1.0)


def _emb_por_turnos(turnos, centros):
    """Huellas de voz falsas: la mezcla de las voces que suenan en cada trozo."""
    def emb(trozos):
        out = []
        for tr in trozos:
            ts = np.linspace(tr.inicio, tr.fin, 40, endpoint=False)
            quien = [next((h for a, b, h in turnos if a <= t < b), None) for t in ts]
            v = np.mean([centros[h] for h in quien if h is not None] or [np.ones(centros.shape[1])], axis=0)
            out.append(v / np.linalg.norm(v))
        return np.array(out)
    return emb


def test_revisar_parte_una_linea_con_dos_personajes():
    centros = np.eye(2, 8)
    # A: 0-3 s; "Ponme un ejemplo." de B (4-5 s) y "¿Un ejemplo? Vale…" de A (5.3-8 s); B: 9-12 s
    turnos = [(0, 3, 0), (4, 5, 1), (5.3, 8, 0), (9, 12, 1)]
    emb = _emb_por_turnos(turnos, centros)
    piezas = [Tramo(0, 3, 0), Tramo(4, 4.5, 0), Tramo(4.5, 5, 0), Tramo(5.3, 6.5, 0), Tramo(6.5, 8, 0), Tramo(9, 12, 1)]
    # La línea 4-8 s ha quedado entera como de A
    lineas = [Tramo(0, 3, 0), Tramo(4, 8, 0), Tramo(9, 12, 1)]
    r = revisar_lineas(lineas, piezas, emb)
    assert [(l.inicio, l.fin, l.hablante) for l in r] == [(0, 3, 0), (4, 5, 1), (5.3, 8, 0), (9, 12, 1)]


def test_revisar_no_toca_las_lineas_de_un_solo_personaje():
    centros = np.eye(2, 8)
    turnos = [(0, 3, 0), (3.5, 7, 0), (8, 11, 1)]
    emb = _emb_por_turnos(turnos, centros)
    piezas = [Tramo(0, 1.5, 0), Tramo(1.5, 3, 0), Tramo(3.5, 7, 0), Tramo(8, 11, 1)]
    lineas = [Tramo(0, 7, 0), Tramo(8, 11, 1)]
    assert revisar_lineas(lineas, piezas, emb) == lineas
