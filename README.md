# DubGame 🎭

Juego multijugador de **doblaje en castellano de España**. Cada uno entra desde su móvil u ordenador con un código de sala, dobla su parte de una escena famosa de cine, Disney o videojuegos, y al final se ve el **montaje completo** con todas las voces sincronizadas y el volumen igualado.

- **Modo "un personaje por jugador"**: si sois 3, solo salen escenas de 3 personajes y cada uno dobla uno.
- **Modo "en solitario"**: cada jugador dobla la escena entera; después se ven todas las versiones y se vota la mejor.
- **Escuchar la voz original** (activable): oyes al personaje bajito como guía mientras doblas tu parte.
- Las líneas salen **una a una**, con unos segundos de escena antes y cuenta atrás. Puedes escuchar tu toma y repetirla.
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

Ya incluye 3 packs de prueba (“La entrevista”, “El atraco” y “El narrador”), así que se puede jugar al momento.

### Jugar desde otros dispositivos

Los navegadores solo dejan usar el micrófono con HTTPS (o en `localhost`). Para jugar en red:

```bash
HTTPS=1 npm start            # https://<ip-de-tu-ordenador>:3000
```

El certificado es autofirmado: la primera vez cada dispositivo tiene que aceptar el aviso del navegador. Para jugar con gente fuera de tu casa puedes usar un túnel (por ejemplo `cloudflared tunnel --url http://localhost:3000`), que ya da HTTPS.

**Consejo:** usad auriculares; así el micrófono solo recoge vuestra voz.

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
2. **Separa las voces de la música/efectos** (Spleeter o UVR), para que al doblar se oiga el fondo sin las voces.
3. Detecta los tramos con voz (VAD Silero).
4. **Identifica quién habla** en cada tramo (diarización + agrupamiento por huella de voz CAM++).
5. Divide en líneas y las **transcribe** con Whisper.
6. Si hay receta, **ajusta el guion al audio**: por texto si el clip está en castellano, o por turnos y duraciones si está en otro idioma.
7. Guarda el pack en `packs/<id>/`. Si alguna línea es dudosa, queda en estado *REVISAR*.

La primera vez descarga los modelos (unos cientos de MB) en `~/.dubgame/modelos`.

Después puedes repasar cualquier pack en el **editor**: forma de onda con las líneas por personaje (arrastra los bordes para ajustar tiempos), cambiar quién dice cada línea, dividir/unir, renombrar personajes y corregir el texto (con un botón para usar lo que se oye).

### Traducción automática al castellano (opcional)

Si el clip está en otro idioma, el editor muestra el botón **Traducir al castellano**, que usa Claude para adaptar las líneas al castellano de España respetando la duración de cada una. Solo aparece si el servidor tiene la variable `ANTHROPIC_API_KEY`:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

### Compartir packs

Desde **Dub Packs → Detalles → Exportar .dubpack** se descarga el pack en un archivo, y con **Importar .dubpack** se instala en otro ordenador. Solo hace falta tener los packs en el ordenador que hace de servidor.

### Precisión del motor (escenas de prueba)

`npm run packs:prueba` genera 3 escenas con voces sintéticas en castellano (guion y tiempos conocidos), las pasa por el motor y mide el resultado:

| Escena | Personajes | Personaje correcto (con receta) | Personaje correcto (automático) | Error medio de tiempos |
|---|---|---|---|---|
| La entrevista | 2 | 100 % | 100 % | ~0,1 s |
| El atraco | 3 | 100 % | 92 % | ~0,1 s |
| El narrador | 1 | 100 % | 100 % | ~0,1 s |

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
