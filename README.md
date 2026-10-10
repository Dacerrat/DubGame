# DubGame 🎭

Juego multijugador de **doblaje en castellano de España**. Cada uno entra desde su móvil u ordenador con un código de sala, dobla su parte de una escena famosa de cine, Disney o videojuegos, y al final se ve el **montaje completo** con todas las voces sincronizadas y el volumen igualado.

- **Modo "un personaje por jugador"**: si sois 3, solo salen escenas de 3 personajes y cada uno dobla uno.
- **Modo "en solitario"**: cada jugador dobla la escena entera; después se ven todas las versiones y se vota la mejor.
- **Escuchar la voz original** (activable): oyes al personaje bajito como guía mientras doblas tu parte.
- Las líneas salen **una a una**: cuenta atrás de 3 segundos con la imagen congelada y suena **solo tu línea**, sin nada antes ni después. Si te alargas, se sigue grabando hasta que termines. Puedes escuchar tu toma y repetirla.
- **Dub Packs**: cada escena es un pack (vídeo + fondo sin voces + voces originales + guion). El **motor** los crea solo a partir de un vídeo.

## Requisitos

- **Node.js 20+**
- **Python 3.10+** (solo para crear packs con el motor)
- **ffmpeg** (opcional, para descargar el montaje como vídeo MP4; el motor trae el suyo)

## Instalación y arranque

```bash
npm install
npm run build
npm start                    # http://localhost:3000
```

Ya incluye 5 packs de prueba (“La entrevista”, “El atraco”, “El narrador”, “Las llaves” y “El mago”), así que se puede jugar al momento.

### Jugar desde otros dispositivos

Los navegadores solo dejan usar el micrófono con HTTPS (o en `localhost`). Para jugar en red:

```bash
HTTPS=1 npm start            # https://<ip-de-tu-ordenador>:3000
```

El certificado es autofirmado: la primera vez cada dispositivo tiene que aceptar el aviso del navegador. Para jugar con gente fuera de tu casa puedes usar un túnel (por ejemplo `cloudflared tunnel --url http://localhost:3000`), que ya da HTTPS.

**Consejo:** usad auriculares; así el micrófono solo recoge vuestra voz (con altavoces, elige "Con altavoces" antes de grabar para activar la cancelación de eco).

**Volumen:** si los vídeos se oyen muy flojos o muy fuertes, usa el control del altavoz (en la cabina de grabación, el montaje, el editor y *Opciones → Sonido*, donde hay un botón para probarlo). Va del 0 al 200 %: si la escena ya suena fuerte, la subida se limita para que no sature. Con el puntero encima, la rueda del ratón lo mueve de 5 en 5, y en la cabina también las teclas <kbd>+</kbd> y <kbd>−</kbd>. Cada dispositivo lo recuerda. Solo cambia lo que oyes, no lo que grabas ni lo que descargas.

### Sincronía

- **Las tomas se sincronizan solas**: el juego detecta dónde empieza tu voz y la coloca donde empezaba la voz original, aunque arranques un poco tarde. También recorta los silencios y no te corta si te alargas un poco.
- **Auriculares Bluetooth**: tienen retraso y el vídeo y los subtítulos parecen ir adelantados. En *Opciones → Sincronía* (o antes de grabar, en "Ajustar sincronía") suenan unos clics: pulsa Espacio con cada uno y el juego compensa tu retraso.
- En el montaje puedes subir o bajar la **música y efectos** del fondo.
- Al doblar ves la **forma de onda** de tu línea: la voz original (azul) y la tuya superpuesta (naranja con contorno, en directo mientras grabas), con un cabezal que avanza y la **entonación** de las dos para compararla. Los colores se distinguen con cualquier tipo de daltonismo.

## Crear packs (motor automático)

```bash
npm run motor:instalar       # crea .venv e instala el motor (una vez)
```

Hay tres formas de crear un pack, desde la pantalla **Crear pack** del juego (solo en el ordenador servidor) o por terminal:

```bash
# 1) Escenas famosas ya preparadas ("recetas": personajes + guion en castellano)
npm run pack -- recetas                                   # lista las recetas
npm run pack -- --receta shrek-hombre-de-las-magdalenas   # prepara una
npm run packs:recetas                                     # prepara todas las que falten

# 2) Cualquier enlace (YouTube…)
npm run pack -- --url "https://www.youtube.com/watch?v=..." --inicio 1:20 --fin 2:35 --titulo "Mi escena"

# 3) Un archivo de vídeo propio
npm run pack -- --video escena.mp4 --titulo "Mi escena" --tipo pelicula --hablantes 2
```

Qué hace el motor (todo en local, con [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)):

1. Descarga el clip (yt-dlp) y lo recorta.
2. **Separa las voces de la música/efectos** (UVR por defecto; Spleeter es más rápido pero a veces distorsiona), para que al doblar se oiga el fondo sin las voces.
3. Detecta los tramos con voz (VAD Silero).
4. **Identifica quién habla** aunque se contesten sin pausa: huellas de voz de dos modelos combinados (CAM++ y TitaNet) en ventanas cortas, cortes en las micro-pausas entre palabras y también donde las ventanas oyen otra voz aunque no haya pausa, y cada trozo asignado por su voz (así un "¿Por ejemplo?" de otro personaje no se queda pegado a tu frase). Al final **revisa cada línea**: si a un lado de una pausa suena un personaje y al otro, otro, la parte ahí.
5. Divide en líneas (las frases seguidas de un mismo personaje van juntas, hasta 10 s) y las **transcribe con contexto** (Whisper turbo): oye la conversación entera y reparte el texto entre las líneas, porque frase a frase se equivoca mucho más. Lo que no es voz (`[Música]`, risas…) no se convierte en línea, ni las frases que Whisper se inventa en ruidos flojos (un “¡Gracias!” donde no hay nadie).
6. Si hay receta, **ajusta el guion al audio**. Si el clip está en castellano mandan siempre el audio real: los tiempos son los de cada frase detectada y el texto es el que se oye (el de la receta solo se usa si coincide de verdad); la receta pone los nombres de los personajes. Si el clip está en otro idioma, se usa el guion en castellano de la receta repartido por turnos (o la traducción de Claude, si está configurada). Si el vídeo descargado no se parece a la receta, el pack queda en *REVISAR* con un aviso.
7. Guarda el pack en `packs/<id>/`. Si alguna línea es dudosa, queda en estado *REVISAR*.

La primera vez descarga los modelos (unos cientos de MB) en `~/.dubgame/modelos`. Los vídeos descargados se guardan en `~/.dubgame/descargas`, así que al rehacer un pack (por ejemplo con `--forzar` tras actualizar el juego) no se vuelven a bajar; puedes borrar esa carpeta cuando quieras. Si YouTube corta la descarga, el motor reintenta solo y sigue donde se quedó.

Después puedes repasar cualquier pack en el **editor**: forma de onda con las líneas por personaje (arrastra los bordes para ajustar tiempos), cambiar quién dice cada línea, dividir/unir, renombrar personajes y corregir el texto (con un botón para usar lo que se oye). **Dividir** corta por la pausa más larga de la línea y el texto por el final de frase, así que una línea con dos personajes (“Ponme un ejemplo. ¿Un ejemplo?”) se arregla con un clic y cambiando el personaje de una mitad.

### Traducción automática al castellano (opcional)

Si el clip está en otro idioma, el editor muestra el botón **Traducir al castellano**, que usa Claude para adaptar las líneas al castellano de España respetando la duración de cada una. Solo aparece si el servidor tiene la variable `ANTHROPIC_API_KEY`:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

### Compartir packs

Desde **Dub Packs → Detalles → Exportar .dubpack** se descarga el pack en un archivo, y con **Importar .dubpack** se instala en otro ordenador. Solo hace falta tener los packs en el ordenador que hace de servidor.

### Precisión del motor (escenas de prueba)

`npm run packs:prueba` genera 5 escenas con voces sintéticas en castellano (guion y tiempos conocidos), las pasa por el motor y mide el resultado:

| Escena | Personajes | Personaje correcto (con receta) | Personaje correcto (automático) | Desfase medio inicio / fin |
|---|---|---|---|---|
| La entrevista | 2 | 100 % | 100 % | 0,1 / 0,2 s |
| El atraco | 3 | 100 % | 100 % | 0,1 / 0,2 s |
| El narrador | 1 | 100 % | 100 % | 0,1 / 0,2 s |
| Las llaves (diálogo rápido, réplicas de una palabra) | 2 | 100 % | 95 % | 0,1 / 0,1 s |
| El mago (contestaciones pegadas, pausas dramáticas y música alta) | 2 | 100 % | 92 % | 0,1 / 0,1 s |

El desfase del final es en parte a propósito: cada línea lleva un pequeño margen para no cortar la última sílaba. Errores de transcripción (Whisper turbo, lo que se oye): 0-8 % de palabras, casi todo grafías («puzzles», «tic-tac») o una palabra en el borde entre dos frases; con receta, el texto sale exacto en las 5.

Lo que aún falla sin receta es siempre lo mismo: un «¡No!» de 0,3 s pegado a la frase del otro personaje, demasiado corto para reconocer la voz. Con receta sale bien y, si no, en el editor se arregla con **Dividir**. Cuando las partes mezcladas son más largas, la revisión del paso 4 las separa: en una prueba con 100 líneas a las que se les juntó a propósito la réplica del otro personaje, separó bien 94; las 6 restantes eran réplicas de una sola palabra.

#### Con voces reales

Las voces sintéticas no bastan para medir esto, así que hay un banco de pruebas con **voces humanas reales**: conversaciones reales anotadas (la muestra de pyannote y 10 fragmentos de reuniones del corpus AMI) y diálogos rápidos montados con grabaciones reales de varias personas, con música y muchas réplicas cortas, todo pasado por la separación de voces igual que un clip de verdad. Con el número de personajes conocido (como con receta):

| | Líneas con dos personajes | Réplicas cortas (< 0,8 s) mal asignadas | Tiempo de voz asignado a otro personaje |
|---|---|---|---|
| Diálogos con voces reales, antes | 6,1 % | 10 % | 3,7 % |
| Diálogos con voces reales, ahora | **0,9 %** | **5 %** | **1,8 %** |
| Conversación real de pyannote, antes → ahora | 33 % → **0 %** | 50 % → **0 %** | 6,7 % → **1,5 %** |
| Reuniones AMI (10 fragmentos), antes → ahora | 4,6 % → **2,0 %** | 42 % → 37 % | 16 % → 14 % |

Las reuniones de AMI salen peor porque son grabaciones de sala con mucha reverberación, y la separación de voces se come parte de lo que dicen. También se probó la diarización completa de pyannote (segmentation-3.0): en voces reales mezcla bastante más, porque junta voces parecidas en el mismo hablante.

Con un guion que **no** coincide con el audio (frases parafraseadas, inventadas o que faltan), los tiempos y los personajes siguen saliendo bien y el texto es el que se oye.

Si creaste packs con una versión anterior del juego, vuelve a crearlos para aprovechar estas mejoras, por ejemplo `npm run pack -- --receta shrek-pantano-asno --forzar`.

## Recetas incluidas

Disney/Pixar: Toy Story, Los Increíbles (×2), Zootrópolis, El emperador y sus locuras, Hércules, Aladdín, El Rey León, Monstruos S.A.
Películas y series: Shrek (×2), Star Wars III, La vida de Brian (4 personajes), Los Simpson.
Videojuegos: God of War (Kratos se lanza al vacío), God of War 2018, Clair Obscur: Expedition 33 (Gustave y el gestral), The Binding of Isaac (intro), GTA San Andreas (Big Smoke), Portal 2, The Last of Us, Five Nights at Freddy's, Hollow Knight, Metal Gear Solid.

Los guiones son versiones propias en castellano que siguen cada escena; el motor ajusta los tiempos al audio real y en el editor puedes cambiar el texto por el que se oye en el clip. Para añadir una escena, crea un `.json` en `engine/recetas/` con el mismo formato.

> **Copyright:** los clips de películas y juegos tienen derechos de autor. El repositorio no incluye ningún vídeo con copyright: el motor los descarga en tu ordenador para uso privado. No subas los packs generados a sitios públicos.

## Desarrollo

```bash
npm run dev                  # servidor + cliente con recarga (http://localhost:5173)
npm test                     # tests unitarios (reglas, salas, normalización y mezcla de audio)
npm run typecheck
npx playwright test          # 2 partidas completas con micrófono simulado
npm run motor:instalar -- --dev && (cd engine && ../.venv/bin/python -m pytest)
```

Estructura:

```
client/   interfaz (React): pantallas, motor de audio (grabación, normalización, mezcla)
server/   salas (Socket.IO), tomas, packs, creador de packs, traducción
shared/   tipos y reglas de juego
engine/   motor de Dub Packs (Python): separación, diarización, transcripción, alineado, recetas
packs/    packs instalados (solo los de prueba van en el repositorio)
```
