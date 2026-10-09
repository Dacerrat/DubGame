from dubengine.alinear import Detectada, LineaGuion, alinear, normalizar, similitud

GUION = [
    LineaGuion("a", "Hola, ¿qué tal estás hoy?"),
    LineaGuion("b", "Muy bien, gracias. ¿Y tú?"),
    LineaGuion("a", "Pues aquí, doblando una escena."),
    LineaGuion("b", "¡Qué casualidad, yo también!"),
]


def test_normalizar_quita_tildes_y_signos():
    assert normalizar("¡Qué TAL, Ñandú!") == "que tal nandu"
    assert similitud("Hola, ¿qué tal?", "hola que tal") == 1.0


def test_mismo_idioma_con_transcripcion_imperfecta():
    det = [
        Detectada(1.0, 2.6, 0, "hola que tal estas hoy"),
        Detectada(3.0, 4.6, 1, "muy bien gracias y tu"),
        Detectada(5.0, 7.0, 0, "pues aqui doblando una escena"),
        Detectada(7.4, 9.0, 1, "que casualidad yo tambien"),
    ]
    out, sobrantes = alinear(GUION, det, mismo_idioma=True)
    assert [(o.personaje, o.inicio, o.fin) for o in out] == [("a", 1.0, 2.6), ("b", 3.0, 4.6), ("a", 5.0, 7.0), ("b", 7.4, 9.0)]
    assert not sobrantes
    assert all(o.confianza > 0.6 for o in out)


def test_ignora_voces_extra_y_une_tramos_partidos():
    det = [
        Detectada(0.2, 0.8, 2, "eh"),  # alguien de fondo
        Detectada(1.0, 1.7, 0, "hola que tal"),
        Detectada(1.8, 2.6, 0, "estas hoy"),  # la línea 1 partida en dos
        Detectada(3.0, 4.6, 1, "muy bien gracias y tu"),
        Detectada(5.0, 7.0, 0, "pues aqui doblando una escena"),
        Detectada(7.4, 9.0, 1, "que casualidad yo tambien"),
    ]
    out, sobrantes = alinear(GUION, det, mismo_idioma=True)
    assert out[0].inicio == 1.0 and out[0].fin == 2.6
    assert [s.texto for s in sobrantes] == ["eh"]


def test_linea_que_falta_se_coloca_en_el_hueco():
    det = [
        Detectada(1.0, 2.6, 0, "hola que tal estas hoy"),
        Detectada(5.0, 7.0, 0, "pues aqui doblando una escena"),
        Detectada(7.4, 9.0, 1, "que casualidad yo tambien"),
    ]
    out, _ = alinear(GUION, det, mismo_idioma=True)
    assert len(out) == 4
    assert out[1].confianza == 0.0
    assert 2.6 <= out[1].inicio < out[1].fin <= 5.0


def test_otro_idioma_por_turnos_y_duraciones():
    # Audio en inglés: el texto no se parece, pero los turnos y duraciones sí
    det = [
        Detectada(1.0, 2.8, 0, "hi how are you doing today"),
        Detectada(3.1, 4.7, 1, "very well thanks and you"),
        Detectada(5.0, 7.1, 0, "well here dubbing a scene"),
        Detectada(7.4, 9.1, 1, "what a coincidence me too"),
    ]
    out, _ = alinear(GUION, det, mismo_idioma=False)
    assert [(o.personaje, o.inicio) for o in out] == [("a", 1.0), ("b", 3.1), ("a", 5.0), ("b", 7.4)]
    assert out[0].texto == GUION[0].texto  # se queda el texto en castellano
