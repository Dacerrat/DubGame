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


def test_desde_audio_usa_lo_que_se_oye_si_el_guion_no_coincide():
    from dubengine.alinear import lineas_desde_audio

    guion = [
        LineaGuion("shrek", "Los ogros son como las cebollas."),
        LineaGuion("asno", "¿Apestan?"),
        LineaGuion("shrek", "¡Sí! ¡No! Capas, las cebollas tienen capas."),
        LineaGuion("asno", "A todo el mundo le gusta la tarta."),
    ]
    det = [
        Detectada(1.0, 3.0, 0, "los ogros son como las cebollas"),       # coincide
        Detectada(3.4, 4.2, 1, "huelen mal"),                            # el doblaje real dice otra cosa
        Detectada(4.6, 7.0, 0, "si no capas las cebollas tienen capas"),  # coincide
        Detectada(7.5, 8.2, 2, "eh vosotros"),                           # voz que no está en el guion
        Detectada(8.6, 10.6, 1, "a todo el mundo le gusta la tarta"),     # coincide
    ]
    out, sobrantes = lineas_desde_audio(guion, det)
    assert [(o.personaje, o.inicio, o.fin) for o in out] == [
        ("shrek", 1.0, 3.0), ("asno", 3.4, 4.2), ("shrek", 4.6, 7.0), ("asno", 8.6, 10.6)]
    assert out[0].texto == "Los ogros son como las cebollas."  # texto limpio del guion
    assert out[1].texto == "huelen mal"  # lo que se oye de verdad
    assert [s.texto for s in sobrantes] == ["eh vosotros"]


def test_desde_audio_no_reparte_tiempos_a_ojo():
    from dubengine.alinear import lineas_desde_audio

    guion = [LineaGuion("a", "Hola."), LineaGuion("a", "¿Qué tal estás?"), LineaGuion("b", "Muy bien, gracias.")]
    det = [Detectada(1.0, 3.2, 0, "hola que tal estas"), Detectada(3.6, 5.0, 1, "muy bien gracias")]
    out, _ = lineas_desde_audio(guion, det)
    assert [(o.personaje, o.inicio, o.fin) for o in out] == [("a", 1.0, 3.2), ("b", 3.6, 5.0)]


def test_desde_audio_manda_la_voz_y_no_el_texto_del_guion():
    from dubengine.alinear import lineas_desde_audio

    guion = [
        LineaGuion("shrek", "Los ogros somos como las cebollas."),
        LineaGuion("asno", "¿Apestan?"),
        LineaGuion("shrek", "Las cebollas tienen capas."),
        LineaGuion("asno", "A todo el mundo le gusta la tarta."),
        LineaGuion("shrek", "¡Me dan igual las tartas!"),
    ]
    det = [
        Detectada(1.0, 3.0, 0, "los ogros son como las cebollas"),
        Detectada(3.4, 4.2, 1, "apestan"),
        Detectada(4.6, 7.0, 0, "las cebollas tienen capas"),
        # Por texto se parece a una frase de Shrek, pero la voz es la de Asno (hablante 1)
        Detectada(7.5, 9.0, 1, "me dan igual las tartas"),
    ]
    out, _ = lineas_desde_audio(guion, det)
    por_inicio = {o.inicio: o.personaje for o in out}
    assert por_inicio[7.5] == "asno"
    assert por_inicio[1.0] == "shrek" and por_inicio[3.4] == "asno"
