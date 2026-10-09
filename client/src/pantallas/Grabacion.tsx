import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EstadoSala, Linea, Pack } from '../../../shared/tipos';
import { lineasDeJugador } from '../../../shared/reglas';
import { acciones, api } from '../conexion';
import {
  type AudioPack, Microfono, type ModoMicro, type Pista, type Reproduccion, canalesDe, cargarAudioPack, contexto, crearBuffer,
  despertar, esperar, guardarModoMicro, latenciaSalida, modoMicro, reproducir,
} from '../audio/motor';
import { codificarWav } from '../audio/wav';
import { aMono, deteccionVoz, normalizarVoz } from '../audio/dsp';
import { MARGEN_TOMA, colocarToma } from '../audio/mezcla';
import { Encabezado, Marco, Selector, useTeclas, useToast } from '../ui/componentes';
import { Calibracion } from '../ui/Calibracion';
import { GuiaOnda, type MuestraDirecto } from '../ui/GuiaOnda';
import { usePack } from './Sala';

/** Cuenta atrás (s) con la imagen congelada antes de cada línea. */
const CUENTA = 3;
/** Al grabar y al escuchar suena solo tu línea, con este pequeño margen (s). */
const ANTES = 0.05;
const DESPUES = 0.25;
/** Tras el final de la línea se sigue grabando mientras hables (s). */
const COLA_MIN = 0.35;
const COLA_MAX = 1.5;

/** Pitidos de la cuenta atrás (3, 2, 1) antes de `cero` (hora del AudioContext). */
function pitidos(ctx: AudioContext, cero: number) {
  for (const k of [3, 2, 1]) {
    const t = cero - k;
    if (t < ctx.currentTime) continue;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.1);
  }
}

interface Sesion {
  codigo: string;
  jugadorId: string;
  token: string;
}

interface Toma {
  datos: Float32Array;
  sr: number;
  en: number;
  silenciosa: boolean;
  linea: { inicio: number; fin: number };
}

type Paso = 'listo' | 'grabando' | 'revisar' | 'subiendo' | 'reproduciendo';

export function Grabacion({ sala, sesion }: { sala: EstadoSala; sesion: Sesion }) {
  const yo = sesion.jugadorId;
  const pack = usePack(sala.config.packId);
  const progreso = sala.progreso[yo];
  const participo = !!progreso;
  const misLineas = useMemo(
    () => (pack ? lineasDeJugador(pack, sala.config.modo, sala.asignacion, yo) : []),
    [pack, sala.config.modo, sala.asignacion, yo],
  );

  if (!pack) return <div className="cargando">CARGANDO ESCENA…</div>;
  if (!participo || progreso.terminado) return <Espera sala={sala} yo={yo} pack={pack} />;
  return <Cabina sala={sala} sesion={sesion} pack={pack} lineas={misLineas} />;
}

function Cabina({ sala, sesion, pack, lineas }: { sala: EstadoSala; sesion: Sesion; pack: Pack; lineas: Linea[] }) {
  const yo = sesion.jugadorId;
  const [audio, setAudio] = useState<AudioPack | null>(null);
  const [mic, setMic] = useState<Microfono | null>(null);
  const [errorMic, setErrorMic] = useState('');
  const [modo, setModo] = useState<ModoMicro>(modoMicro());
  const [calibrando, setCalibrando] = useState(false);
  const subidas = sala.tomas[yo] ?? [];
  const vozOriginal = useMemo(() => (audio ? aMono(canalesDe(audio.voces)) : null), [audio]);
  const [indice, setIndice] = useState(() => {
    const i = lineas.findIndex((l) => !subidas.includes(l.id));
    return i < 0 ? 0 : i;
  });
  const [paso, setPaso] = useState<Paso>('listo');
  const [toma, setToma] = useState<Toma | null>(null);
  // La toma tal y como sonará en el montaje (sincronizada y sin silencios)
  const tomaColocada = useMemo(
    () => (toma && audio && !toma.silenciosa
      ? { ...colocarToma(toma, canalesDe(audio.voces), audio.voces.sampleRate), sr: toma.sr }
      : null),
    [toma, audio],
  );
  const linea0 = lineas[indice];
  // La guía muestra solo tu línea (y tu toma entera, si te alargas)
  const ventanaGuia = useMemo(() => {
    if (!linea0) return { desde: 0, hasta: 1 };
    let desde = linea0.inicio - 0.15;
    let hasta = linea0.fin + 0.4;
    if (tomaColocada) {
      desde = Math.min(desde, tomaColocada.en - 0.05);
      hasta = Math.max(hasta, tomaColocada.en + tomaColocada.datos.length / tomaColocada.sr + 0.1);
    }
    return { desde: Math.max(0, desde), hasta: Math.min(pack.duracion, hasta) };
  }, [linea0, tomaColocada, pack.duracion]);
  const originalVentana = useMemo(() => {
    if (!vozOriginal || !audio) return null;
    const sr = audio.voces.sampleRate;
    return vozOriginal.subarray(Math.floor(ventanaGuia.desde * sr), Math.floor(ventanaGuia.hasta * sr));
  }, [vozOriginal, audio, ventanaGuia]);
  const [pos, setPos] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const repRef = useRef<Reproduccion | null>(null);
  // Reloj del cabezal: sigue corriendo tras la reproducción mientras grabas la cola
  const relojRef = useRef<{ t0: number; desde: number } | null>(null);
  const pasoRef = useRef<Paso>('listo');
  pasoRef.current = paso;
  const micRef = useRef<Microfono | null>(null);
  micRef.current = mic;
  const directo = useRef<MuestraDirecto[]>([]);
  const [toast, avisar] = useToast();
  const linea = lineas[indice];
  const personaje = (id: string) => pack.personajes.find((p) => p.id === id);
  const guia = sala.config.escucharOriginal;

  useEffect(() => {
    cargarAudioPack(pack.id).then(setAudio).catch((e) => avisar(e.message));
  }, [pack.id, avisar]);

  useEffect(() => () => {
    repRef.current?.parar();
    mic?.cerrar();
  }, [mic]);

  // Posición del cabezal para la cuenta atrás y la guía de onda
  useEffect(() => {
    let raf = 0;
    const bucle = () => {
      const r = relojRef.current;
      if (r) {
        const ctx = contexto();
        const p = r.desde + (ctx.currentTime - r.t0) - latenciaSalida(ctx);
        setPos(p);
        // Tu voz en directo para la guía de onda
        if (pasoRef.current === 'grabando' && micRef.current) directo.current.push({ t: p, v: micRef.current.nivel });
      }
      raf = requestAnimationFrame(bucle);
    };
    raf = requestAnimationFrame(bucle);
    return () => cancelAnimationFrame(raf);
  }, []);

  const prepararMic = async () => {
    setErrorMic('');
    try {
      await despertar();
      guardarModoMicro(modo);
      setMic(await Microfono.abrir(modo));
    } catch (e) {
      setErrorMic((e as Error).message.includes('Permission') || (e as Error).name === 'NotAllowedError'
        ? 'Has denegado el permiso del micrófono. Actívalo en el navegador para jugar.'
        : (e as Error).message);
    }
  };

  const tramo = (l: Linea) => ({
    desde: Math.max(0, l.inicio - ANTES),
    hasta: Math.min(pack.duracion, l.fin + DESPUES),
  });

  const parar = () => {
    repRef.current?.parar();
    repRef.current = null;
    relojRef.current = null;
  };

  const seguir = (rep: Reproduccion, desde: number) => {
    repRef.current = rep;
    relojRef.current = { t0: rep.t0, desde };
  };

  const grabar = useCallback(async () => {
    if (!audio || !mic || !linea || paso === 'grabando' || paso === 'subiendo') return;
    parar();
    setPaso('grabando');
    setToma(null);
    directo.current = [];
    const ctx = await despertar();
    const { desde, hasta } = tramo(linea);
    setPos(desde - CUENTA);
    // Solo suena tu línea: fondo y, si está activada, la voz original bajita como guía
    const pistas: Pista[] = [{ buffer: audio.fondo, en: 0 }];
    if (guia) pistas.push({ buffer: audio.voces, en: 0, ganancia: 0.3 });
    // Cuenta atrás con la imagen congelada en el primer fotograma de la línea
    const rep = await reproducir({ desde, hasta, video: videoRef.current, pistas, retraso: CUENTA });
    seguir(rep, desde);
    pitidos(ctx, rep.t0 + (linea.inicio - desde));
    await rep.terminada;
    if (repRef.current !== rep) return; // cancelada
    const lat = latenciaSalida(ctx) + 0.01;
    const ini = rep.t0 + (linea.inicio - desde) - MARGEN_TOMA + lat;
    // Si sigues hablando al acabar la línea, se sigue grabando hasta que termines
    const finLinea = rep.t0 + (linea.fin - desde) + lat;
    let fin = finLinea + COLA_MAX;
    while (ctx.currentTime < fin + 0.05) {
      const ahora = ctx.currentTime - 0.06; // lo que ya ha llegado del micro
      if (ahora >= finLinea + COLA_MIN) {
        const voz = deteccionVoz(mic.extraer(ini, ahora), ctx.sampleRate);
        if (!voz || ahora - (ini + voz.fin) > 0.3) {
          fin = ahora;
          break;
        }
      }
      await esperar(80);
      if (repRef.current !== rep) return; // cancelada
    }
    repRef.current = null;
    relojRef.current = null;
    const datos = mic.extraer(ini, fin);
    const silenciosa = deteccionVoz(datos, ctx.sampleRate) === null;
    setToma({
      datos, sr: ctx.sampleRate, en: linea.inicio - MARGEN_TOMA, silenciosa,
      linea: { inicio: linea.inicio, fin: linea.fin },
    });
    setPaso('revisar');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, mic, linea, paso, guia]);

  const escuchar = async () => {
    if (!audio || !toma || !linea) return;
    parar();
    setPaso('reproduciendo');
    await despertar();
    // Igual que en el montaje final: sincronizada con la voz original y normalizada
    const colocada = colocarToma(toma, canalesDe(audio.voces), audio.voces.sampleRate);
    const finToma = colocada.en + colocada.datos.length / toma.sr;
    const { desde: d0, hasta: h0 } = tramo(linea);
    const desde = Math.max(0, Math.min(d0, colocada.en - ANTES));
    const hasta = Math.min(pack.duracion, Math.max(h0, finToma + 0.15));
    const rep = await reproducir({
      desde,
      hasta,
      video: videoRef.current,
      pistas: [
        { buffer: audio.fondo, en: 0 },
        { buffer: crearBuffer([normalizarVoz(colocada.datos, toma.sr).datos], toma.sr), en: colocada.en },
      ],
    });
    seguir(rep, desde);
    await rep.terminada;
    if (repRef.current === rep) parar();
    setPaso('revisar');
  };

  const escucharOriginal = async () => {
    if (!audio || !linea) return;
    parar();
    await despertar();
    const { desde, hasta } = tramo(linea);
    const anterior = paso;
    setPaso('reproduciendo');
    const rep = await reproducir({
      desde,
      hasta,
      video: videoRef.current,
      pistas: [{ buffer: audio.fondo, en: 0 }, { buffer: audio.voces, en: 0 }],
    });
    seguir(rep, desde);
    await rep.terminada;
    if (repRef.current === rep) parar();
    setPaso(anterior === 'revisar' ? 'revisar' : 'listo');
  };

  const siguiente = async () => {
    if (!toma || !linea || paso !== 'revisar') return;
    parar();
    setPaso('subiendo');
    try {
      await api.subirToma(sala.codigo, sala.ronda, linea.id, codificarWav(toma.datos, toma.sr), sesion);
      setToma(null);
      if (indice + 1 >= lineas.length) {
        await acciones.terminarGrabacion();
      } else {
        setIndice(indice + 1);
        setPaso('listo');
      }
    } catch (e) {
      avisar(`No se pudo enviar la toma: ${(e as Error).message}`);
      setPaso('revisar');
    }
  };

  useTeclas({
    Espacio: () => (paso === 'listo' || paso === 'revisar' ? grabar() : undefined),
    r: () => (paso === 'revisar' ? grabar() : undefined),
    Enter: () => siguiente(),
    o: () => (guia && (paso === 'listo' || paso === 'revisar') ? escucharOriginal() : undefined),
    e: () => (paso === 'revisar' ? escuchar() : undefined),
  }, !!mic);

  if (!mic) {
    const misPersonajes = sala.config.modo === 'solitario'
      ? pack.personajes
      : pack.personajes.filter((p) => sala.asignacion[p.id] === yo);
    return (
      <>
        <Encabezado titulo={pack.titulo} />
        <div className="estrecho" style={{ maxWidth: 560 }}>
          <Marco titulo={sala.config.modo === 'solitario' ? 'Doblas la escena entera' : 'Tu papel'}>
            <div className="pila">
              {misPersonajes.map((p) => (
                <div key={p.id} style={{ fontSize: 28, borderLeft: `3px solid ${p.color}`, paddingLeft: 12 }} data-testid="mi-personaje">
                  {p.nombre}
                </div>
              ))}
              <p className="tenue" style={{ margin: 0 }}>
                {lineas.length} líneas. Te saldrán una a una, con una cuenta atrás de 3 segundos: solo suena tu línea, sin nada antes ni después.
                {sala.config.escucharOriginal ? ' Oirás la voz original bajita como guía.' : ' No oirás la voz original: ¡a improvisar!'}
              </p>
              <Selector
                nombre="¿Cómo vas a oír el juego?"
                valor={modo}
                ayuda={modo === 'auriculares'
                  ? 'Mejor calidad: el micro graba tu voz tal cual.'
                  : 'Se activa la cancelación de eco para que el micro no grabe el vídeo (la voz pierde algo de calidad).'}
                opciones={[
                  { valor: 'auriculares', texto: 'Con auriculares' },
                  { valor: 'altavoces', texto: 'Con altavoces' },
                ]}
                onCambio={setModo}
              />
              {calibrando ? (
                <Calibracion alTerminar={() => setCalibrando(false)} />
              ) : (
                <p className="tenue" style={{ margin: 0, fontSize: 16 }}>
                  ¿Auriculares Bluetooth? Tienen retraso: <button className="boton peque fantasma" onClick={() => setCalibrando(true)}>Ajustar sincronía</button>
                </p>
              )}
              {errorMic && <p className="error">{errorMic}</p>}
              <div className="fila fin">
                <button className="boton primario grande" onClick={prepararMic} data-testid="activar-micro">Activar micrófono</button>
              </div>
            </div>
          </Marco>
        </div>
        {toast}
      </>
    );
  }

  if (!linea) return <div className="cargando">…</div>;
  const ventana = ventanaGuia;
  const srVoz = audio?.voces.sampleRate ?? 48000;

  const p = personaje(linea.personaje);
  const anterior = pack.lineas.filter((l) => l.fin <= linea.inicio + 0.01).at(-1);
  const enLinea = paso === 'grabando' && pos >= linea.inicio;
  const enCola = enLinea && pos > linea.fin;
  const cuenta = paso === 'grabando' && pos < linea.inicio ? Math.ceil(linea.inicio - pos - 0.02) : null;

  return (
    <div className="escenario">
      <div className="fila" style={{ justifyContent: 'space-between' }}>
        <span className="cinzel tenue" style={{ fontSize: 14 }}>{pack.titulo}</span>
        <span className="cinzel" style={{ fontSize: 14 }} data-testid="contador-lineas">Línea {indice + 1} / {lineas.length}</span>
        <div className="vumetro" title="Nivel del micrófono"><NivelMic mic={mic} /></div>
      </div>
      <div className="pantalla-video">
        <video ref={videoRef} src={`/packs/${pack.id}/video.mp4`} muted playsInline preload="auto" poster={`/packs/${pack.id}/portada.jpg`} />
        {cuenta !== null && cuenta >= 1 && cuenta <= 3 && <div className="cuenta">{cuenta}</div>}
        {enLinea && <div className="rec">GRABANDO</div>}
      </div>
      <div className="pasos">
        {lineas.map((l, i) => <span key={l.id} className={i < indice ? 'hecho' : i === indice ? 'actual' : ''} />)}
      </div>
      {anterior && anterior.id !== linea.id && (
        <div className="contexto">
          <b style={{ color: personaje(anterior.personaje)?.color }}>{personaje(anterior.personaje)?.nombre}:</b> {anterior.texto}
        </div>
      )}
      <div className="linea-actual">
        <div className="personaje" style={{ color: p?.color }}>{p?.nombre}</div>
        <div className="texto" data-testid="texto-linea">
          <span className={enLinea ? 'texto-activo' : ''}>{linea.texto || '(sin texto)'}</span>
        </div>
      </div>
      <div className={`reloj-linea ${enLinea ? 'activo' : ''}`} data-testid="reloj-linea">
        <GuiaOnda
          original={originalVentana}
          sr={srVoz}
          desde={ventana.desde}
          hasta={ventana.hasta}
          linea={linea}
          pos={relojRef.current ? pos : null}
          toma={paso === 'grabando' ? null : tomaColocada}
          directo={directo.current}
        />
        <div className="cifra">
          {cuenta !== null
            ? `Empieza en ${Math.max(1, Math.min(CUENTA, cuenta))}…`
            : enCola
              ? '¡Remata!'
              : enLinea
              ? `${Math.max(0, linea.fin - pos).toFixed(1)} s`
              : `${(linea.fin - linea.inicio).toFixed(1)} s para esta línea`}
        </div>
      </div>

      {toma?.silenciosa && paso === 'revisar' && (
        <p className="aviso centrado">No se oye tu voz en la toma. ¿Está bien el micrófono?</p>
      )}

      <div className="fila centro">
        {guia && (
          <button className="boton" disabled={paso === 'grabando' || paso === 'subiendo'} onClick={escucharOriginal}>
            🔊 Escuchar original
          </button>
        )}
        {paso !== 'revisar' && paso !== 'subiendo' ? (
          <button
            className={`boton grande ${paso === 'grabando' ? 'grabando' : 'primario'}`}
            disabled={!audio || paso !== 'listo'}
            onClick={grabar}
            data-testid="grabar"
          >
            {!audio ? 'Cargando audio…' : paso === 'grabando' ? 'Grabando…' : '● Grabar'}
          </button>
        ) : (
          <>
            <button className="boton" onClick={escuchar} disabled={paso === 'subiendo'} data-testid="escuchar-toma">▶ Escuchar</button>
            <button className="boton" onClick={grabar} disabled={paso === 'subiendo'} data-testid="repetir">↺ Repetir</button>
            <button className="boton primario grande" onClick={siguiente} disabled={paso === 'subiendo'} data-testid="siguiente">
              {paso === 'subiendo' ? 'Enviando…' : indice + 1 >= lineas.length ? 'Terminar' : 'Siguiente ›'}
            </button>
          </>
        )}
        {paso === 'reproduciendo' && <button className="boton" onClick={parar}>■ Parar</button>}
      </div>
      <div className="atajos">
        <kbd>Espacio</kbd> grabar · <kbd>E</kbd> escuchar toma · <kbd>R</kbd> repetir · <kbd>Intro</kbd> siguiente
        {guia && <> · <kbd>O</kbd> original</>}
      </div>
      {toast}
    </div>
  );
}

function NivelMic({ mic }: { mic: Microfono }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const f = () => {
      setN(mic.nivel);
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [mic]);
  return <div style={{ width: `${Math.min(100, n * 140)}%` }} />;
}

export function Espera({ sala, yo, pack }: { sala: EstadoSala; yo: string; pack: Pack }) {
  const soyAnfitrion = sala.anfitrion === yo;
  const [toast, avisar] = useToast();
  const nombre = (id: string) => sala.jugadores.find((j) => j.id === id);
  return (
    <>
      <Encabezado titulo="Esperando al resto" />
      <div className="estrecho" style={{ maxWidth: 620 }}>
        <Marco titulo={pack.titulo}>
          {Object.entries(sala.progreso).map(([id, pr]) => {
            const j = nombre(id);
            return (
              <div className="progreso-jugador" key={id}>
                <span>{j?.nombre ?? '—'}{j && !j.conectado && <span className="tenue"> (desconectado)</span>}</span>
                <div className="barra"><div style={{ width: `${(pr.grabadas / Math.max(1, pr.total)) * 100}%` }} /></div>
                <span className="tenue">{pr.terminado ? '✓' : `${pr.grabadas}/${pr.total}`}</span>
              </div>
            );
          })}
          <p className="tenue">El montaje empezará cuando todos terminen.</p>
          {soyAnfitrion && (
            <div className="fila fin">
              <button
                className="boton peque"
                onClick={() => {
                  if (confirm('Las líneas que falten se rellenarán con la voz original. ¿Continuar?')) {
                    acciones.forzarMontaje().catch((e) => avisar(e.message));
                  }
                }}
              >
                Pasar al montaje sin esperar
              </button>
            </div>
          )}
        </Marco>
      </div>
      {toast}
    </>
  );
}
