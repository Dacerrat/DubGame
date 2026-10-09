from dubengine.transcripcion import bloques, es_no_voz, limpiar, repartir


def test_no_voz():
    for t in ["[Música]", "(risas)", "♪ la la la ♪", "", "  ", "...", "Subtítulos realizados por la comunidad de Amara.org",
              "¡Suscríbete!", "[MÚSICA]", "Música"]:
        assert es_no_voz(t), t
    for t in ["¿Música? No me gusta.", "No.", "¡Sí!", "Para tu información, un ogro es más complejo"]:
        assert not es_no_voz(t), t


def test_limpiar_guiones_de_dialogo():
    assert limpiar("- A pesta. - Sí. - No, te hacen llorar.") == "A pesta. Sí. No, te hacen llorar."
    assert limpiar("Pues bien-hecho") == "Pues bien-hecho"


def test_bloques_por_huecos_y_duracion():
    lineas = [(0, 1), (1.2, 2), (2.3, 3), (6, 7), (7.1, 8)]
    assert bloques(lineas, max_hueco=1.2) == [[0, 1, 2], [3, 4]]
    largas = [(i * 5.0, i * 5.0 + 4.5) for i in range(8)]
    assert all(largas[b[-1]][1] - largas[b[0]][0] <= 24 for b in bloques(largas))


def test_repartir_con_guias_imperfectas():
    texto = ("Oye, ¿tú has visto mis llaves? ¿Qué llaves? Las del coche. No. ¿Seguro? "
             "Segurísimo. Bueno, a lo mejor.")
    guias = ["oye tu has visto mis llaves", "te llamas", "la del coche", "no", "se vuro", "segurisimo bueno a lo mejor"]
    duraciones = [1.6, 0.6, 0.7, 0.35, 0.45, 2.0]
    assert repartir(texto, guias, duraciones) == [
        "Oye, ¿tú has visto mis llaves?", "¿Qué llaves?", "Las del coche.", "No.", "¿Seguro?",
        "Segurísimo. Bueno, a lo mejor."]


def test_repartir_sin_reparto_convincente():
    assert repartir("hola", ["a", "b"], [1, 1]) is None  # menos palabras que líneas
    assert repartir("frase totalmente distinta de todo", ["xyz abc", "qwe rty"], [1, 1]) is None


def test_alucinaciones_tipicas():
    from dubengine.transcripcion import es_alucinacion

    assert es_alucinacion("¡Gracias!") and es_alucinacion("Muchas gracias.")
    assert not es_alucinacion("Gracias por salvarme la vida, Shrek.")
