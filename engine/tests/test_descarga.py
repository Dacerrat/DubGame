from dubengine.pipeline import error_de_red, mensaje_descarga


def test_cortes_de_conexion_se_reintentan():
    windows = Exception("ERROR: [download] Got error: [WinError 10054] Se ha forzado la interrupción de una "
                        "conexión existente por el host remoto")
    linux = Exception("ERROR: [download] Got error: [Errno 104] Connection reset by peer")
    assert error_de_red(windows) and error_de_red(linux)
    assert not error_de_red(Exception("ERROR: [youtube] abc: Video unavailable"))


def test_mensajes_claros():
    m = mensaje_descarga(Exception("ERROR: [download] Got error: [WinError 10054] Se ha forzado la interrupción"))
    assert m.startswith("No se pudo descargar el vídeo: la conexión se cortó") and "--video" in m
    assert mensaje_descarga(Exception("ERROR: [youtube] abc: Video unavailable")) == \
        "No se pudo descargar el vídeo: abc: Video unavailable"
