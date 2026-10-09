import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EstadoSala, Linea, Pack } from '../../../shared/tipos';
import { lineasDeJugador } from '../../../shared/reglas';
import { acciones, api } from '../conexion';
import {
  type AudioPack, Microfono, type Reproduccion, cargarAudioPack, contexto, crearBuffer, despertar, latenciaSalida, reproducir,
} from '../audio/motor';
import { codificarWav } from '../audio/wav';
import { normalizarVoz, rmsConPuerta } from '../audio/dsp';
import { Encabezado, Marco, useTeclas, useToast } from '../ui/componentes';
import { usePack } from './Sala';

const PREROLL = 3;
const POSTROLL = 0.6;
const MARGEN_TOMA = 0.2;

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
  const subidas = sala.tomas[yo] ?? [];
  const [indice, setIndice] = useState(() => {
    const i = lineas.findIndex((l) => !subidas.includes(l.id));
    return i < 0 ? 0 : i;
  });
  const [paso, setPaso] = useState<Paso>('listo');
  const [toma, setToma] = useState<Toma | null>(null);
  const [pos, setPos] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const repRef = useRef<Reproduccion | null>(null);
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

  // Posición del cabezal para cuenta atrás, karaoke y subtítulos
  useEffect(() => {
    let raf = 0;
    const bucle = () => {
      if (repRef.current) setPos(repRef.current.posicion());
      raf = requestAnimationFrame(bucle);
    };
    raf = requestAnimationFrame(bucle);
    return () => cancelAnimationFrame(raf);
  }, []);

  const prepararMic = async () => {
    setErrorMic('');
    try {
      await despertar();
      setMic(await Microfono.abrir());
    } catch (e) {
      setErrorMic((e as Error).message.includes('Permission') || (e as Error).name === 'NotAllowedError'
        ? 'Has denegado el permiso del micrófono. Actívalo en el navegador para jugar.'
        : (e as Error).message);
    }
  };

  const tramo = (l: Linea) => ({
    desde: Math.max(0, l.inicio - PREROLL),
    hasta: Math.min(pack.duracion, l.fin + POSTROLL),
  });

  const parar = () => {
    repRef.current?.parar();
    repRef.current = null;
  };

  const grabar = useCallback(async () => {
    if (!audio || !mic || !linea || paso === 'grabando' || paso === 'subiendo') return;
    parar();
    await despertar();
    const { desde, hasta } = tramo(linea);
    const rep = reproducir({
      desde,
      hasta,
      video: videoRef.current,
      pistas: [
        { buffer: audio.fondo, en: 0 },
        {
          buffer: audio.voces,
          en: 0,
          automatizacion: [[desde, 1], [linea.inicio - 0.05, guia ? 0.3 : 0], [linea.fin + 0.1, 1]],
        },
      ],
    });
    repRef.current = rep;
    setPaso('grabando');
    setToma(null);
    await rep.terminada;
    if (repRef.current !== rep) return; // cancelada
    repRef.current = null;
    const ctx = contexto();
    const lat = latenciaSalida(ctx) + 0.01;
    const ini = rep.t0 + (linea.inicio - desde) - MARGEN_TOMA + lat;
    const fin = rep.t0 + (linea.fin - desde) + 0.5 + lat;
    const datos = mic.extraer(ini, fin);
    const silenciosa = rmsConPuerta(datos, ctx.sampleRate) < -55;
    setToma({ datos, sr: ctx.sampleRate, en: linea.inicio - MARGEN_TOMA, silenciosa });
    setPaso('revisar');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, mic, linea, paso, guia]);

  const escuchar = async () => {
    if (!audio || !toma || !linea) return;
    parar();
    await despertar();
    const { desde, hasta } = tramo(linea);
    const rep = reproducir({
      desde,
      hasta,
      video: videoRef.current,
      pistas: [
        { buffer: audio.fondo, en: 0, ganancia: 0.7 },
        { buffer: audio.voces, en: 0, automatizacion: [[desde, 1], [linea.inicio - 0.05, 0], [linea.fin + 0.1, 1]] },
        // Misma normalización que en el montaje final
        { buffer: crearBuffer([normalizarVoz(toma.datos, toma.sr).datos], toma.sr), en: toma.en },
      ],
    });
    repRef.current = rep;
    setPaso('reproduciendo');
    await rep.terminada;
    if (repRef.current === rep) repRef.current = null;
    setPaso('revisar');
  };

  const escucharOriginal = async () => {
    if (!audio || !linea) return;
    parar();
    await despertar();
    const desde = Math.max(0, linea.inicio - 0.6);
    const anterior = paso;
    const rep = reproducir({
      desde,
      hasta: Math.min(pack.duracion, linea.fin + 0.4),
      video: videoRef.current,
      pistas: [{ buffer: audio.fondo, en: 0 }, { buffer: audio.voces, en: 0 }],
    });
    repRef.current = rep;
    setPaso('reproduciendo');
    await rep.terminada;
    if (repRef.current === rep) repRef.current = null;
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
                {lineas.length} líneas. Te saldrán una a una: verás unos segundos de escena antes de cada una y una cuenta atrás.
                {sala.config.escucharOriginal ? ' Oirás la voz original bajita como guía.' : ' No oirás la voz original: ¡a improvisar!'}
              </p>
              <p className="aviso" style={{ margin: 0 }}>Ponte auriculares antes de empezar.</p>
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
  const p = personaje(linea.personaje);
  const anterior = pack.lineas.filter((l) => l.fin <= linea.inicio + 0.01).at(-1);
  const enLinea = paso === 'grabando' && pos >= linea.inicio;
  const cuenta = paso === 'grabando' && pos < linea.inicio ? Math.ceil(linea.inicio - pos) : null;
  const progresoLinea = paso === 'grabando' ? Math.max(0, Math.min(1, (pos - linea.inicio) / (linea.fin - linea.inicio))) : paso === 'revisar' ? 1 : 0;
  const subVisible = repRef.current ? pack.lineas.find((l) => pos >= l.inicio && pos <= l.fin) : undefined;

  return (
    <div className="escenario">
      <div className="fila" style={{ justifyContent: 'space-between' }}>
        <span className="cinzel tenue" style={{ fontSize: 14 }}>{pack.titulo}</span>
        <span className="cinzel" style={{ fontSize: 14 }} data-testid="contador-lineas">Línea {indice + 1} / {lineas.length}</span>
        <div className="vumetro" title="Nivel del micrófono"><NivelMic mic={mic} /></div>
      </div>
      <div className="pantalla-video">
        <video ref={videoRef} src={`/packs/${pack.id}/video.mp4`} muted playsInline preload="auto" poster={`/packs/${pack.id}/portada.jpg`} />
        {cuenta !== null && cuenta <= 3 && <div className="cuenta">{cuenta}</div>}
        {enLinea && <div className="rec">GRABANDO</div>}
        {subVisible && subVisible.id !== linea.id && (
          <div className="subtitulo">
            <span className="quien" style={{ color: personaje(subVisible.personaje)?.color }}>{personaje(subVisible.personaje)?.nombre}</span>
            {subVisible.texto}
          </div>
        )}
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
        <div className="pista"><div className="relleno" style={{ width: `${progresoLinea * 100}%` }} /></div>
        <div className="cifra">
          {cuenta !== null
            ? `Empieza en ${cuenta}…`
            : enLinea
              ? `${Math.max(0, linea.fin - pos).toFixed(1)} s`
              : `${(linea.fin - linea.inicio).toFixed(1)} s para esta línea`}
        </div>
      </div>

      {toma?.silenciosa && paso === 'revisar' && (
        <p className="aviso centrado">No se oye casi nada en la toma. ¿Está bien el micrófono?</p>
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
