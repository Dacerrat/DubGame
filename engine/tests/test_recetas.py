from dubengine import recetas


def test_todas_las_recetas_son_validas():
    todas = recetas.todas()
    assert len(todas) >= 20
    ids = set()
    for r in todas:
        assert not recetas.validar(r), (r.get("id"), recetas.validar(r))
        assert r["id"] not in ids
        ids.add(r["id"])
        # Entre 3 y 10 líneas por personaje (escenas largas)
        for p in r["personajes"]:
            n = sum(1 for l in r["guion"] if l["p"] == p["id"])
            assert 3 <= n <= 12, (r["id"], p["id"], n)


def test_a_segundos():
    assert recetas.a_segundos("1:23") == 83
    assert recetas.a_segundos("01:00:01.5") == 3601.5
    assert recetas.a_segundos(None) is None
    assert recetas.a_segundos(12) == 12.0
