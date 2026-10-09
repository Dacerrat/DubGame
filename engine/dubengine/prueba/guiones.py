"""Escenas de prueba originales, sintetizadas con voces en castellano.

Como el guion y los tiempos se conocen exactamente, sirven para medir la
precisión del motor (quién habla, cuándo y qué dice).
"""

# voz: (modelo tts, id de hablante, velocidad)
ESCENAS = [
    {
        "id": "prueba-la-entrevista",
        "titulo": "La entrevista",
        "obra": "Escena de prueba DubGame",
        "personajes": [
            {"id": "periodista", "nombre": "Periodista", "voz": ("sharvard", 1, 1.0)},
            {"id": "chef", "nombre": "Chef Ramírez", "voz": ("davefx", 0, 1.05)},
        ],
        "guion": [
            ("periodista", "Buenas noches y bienvenidos a Cocina Extrema. Hoy tenemos con nosotros al chef Ramírez."),
            ("chef", "Buenas noches. Gracias por invitarme, es un honor estar aquí."),
            ("periodista", "Chef, dicen que su tortilla de patatas lleva un ingrediente secreto."),
            ("chef", "Eso dicen, sí. Pero si se lo cuento, dejará de ser secreto."),
            ("periodista", "Vamos, una pista para nuestros espectadores."),
            ("chef", "Está bien. Empieza por ce y termina por ebolla."),
            ("periodista", "¡Cebolla! ¡Lo sabía! Esto va a provocar un escándalo nacional."),
            ("chef", "Por favor, no se lo diga a mi madre. Ella es del equipo sin cebolla."),
            ("periodista", "Demasiado tarde, estamos en directo para toda España."),
            ("chef", "Pues entonces me voy a tener que mudar a Portugal."),
            ("periodista", "Una última pregunta. ¿Qué opina de la paella con chorizo?"),
            ("chef", "Señorita, hay líneas que un cocinero nunca debe cruzar."),
            ("periodista", "Ahí lo tienen. Esto ha sido Cocina Extrema. ¡Hasta la semana que viene!"),
            ("chef", "Y recuerden, la cebolla siempre bien pochada."),
        ],
    },
    {
        "id": "prueba-el-atraco",
        "titulo": "El atraco",
        "obra": "Escena de prueba DubGame",
        "personajes": [
            {"id": "jefa", "nombre": "La Jefa", "voz": ("sharvard", 1, 0.95)},
            {"id": "novato", "nombre": "El Novato", "voz": ("carlfm", 0, 1.0)},
            {"id": "vigilante", "nombre": "Vigilante", "voz": ("davefx", 0, 1.1)},
        ],
        "guion": [
            ("jefa", "Escuchad bien. Tenemos exactamente tres minutos para entrar y salir."),
            ("novato", "Jefa, una pregunta. ¿Puedo ir antes al baño?"),
            ("jefa", "No. Nadie va al baño en mitad de un atraco."),
            ("vigilante", "¡Alto ahí! ¿Quién anda por el pasillo a estas horas?"),
            ("novato", "Somos los de la limpieza. Venimos a fregar la cámara acorazada."),
            ("vigilante", "¿A las tres de la mañana? Qué raro. Bueno, pasad."),
            ("jefa", "No me lo puedo creer. Ha funcionado."),
            ("novato", "Jefa, ya he abierto la caja fuerte. Pero solo hay croquetas."),
            ("vigilante", "¡Eh, esas croquetas son mías! Me las hizo mi abuela."),
            ("jefa", "Retirada. Repito, retirada. Y dejad las croquetas."),
            ("novato", "Solo me he comido una, lo prometo."),
            ("vigilante", "¡Os voy a denunciar por robo de croquetas!"),
        ],
    },
    {
        "id": "prueba-el-narrador",
        "titulo": "El narrador",
        "obra": "Escena de prueba DubGame",
        "personajes": [
            {"id": "narrador", "nombre": "Narrador", "voz": ("ald", 0, 1.0)},
        ],
        "guion": [
            ("narrador", "Hace mucho tiempo, en un pueblo perdido entre montañas, vivía un caballero sin espada."),
            ("narrador", "Cada mañana se levantaba antes que el sol y salía a buscar aventuras."),
            ("narrador", "Pero en aquel pueblo nunca pasaba nada, salvo alguna gallina escapada."),
            ("narrador", "Un día, una sombra enorme cubrió el cielo y todos corrieron a esconderse."),
            ("narrador", "El caballero levantó la vista, respiró hondo y dijo que no tenía miedo."),
            ("narrador", "Era solo una nube con forma de dragón. Y así terminó su mayor aventura."),
        ],
    },
]
