import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EstadoSala, Pack, Reproduccion as ReproduccionServidor } from '../../../shared/tipos';
import { acciones, api, horaServidorALocal, socket } from '../conexion';
import {
  type Reproduccion, canalesDe, cargarAudioPack, contexto, crearBuffer, despertar, reproducir,
} from '../audio/motor';
import { decodificarWav, codificarWavCanales } from '../audio/wav';
import { MARGEN_TOMA, mezclar, type TomaMontaje } from '../audio/mezcla';
import { Encabezado, Marco, useToast } from '../ui/componentes';
import { usePack } from './Sala';

const TODOS = '__todos__';

interface Entradas {
  sr: number;
  duracion: number;
  fondo: Float32Array[];
  voces: Float32Array[];
  versiones: Map<string, { tomas: TomaMontaje[]; originales: { inicio: number; fin: number }[] }>;
}

function leerFondoDb(): number {
  try {
    const v = Number(localStorage.getItem('dubgame.fondoDb'));
    return Number.isFinite(v) ? Math.max(-12, Math.min(12, v)) : 0;
  } catch {
    return 0;
  }
}

/** Mezcla todas las versiones con el volumen de fondo elegido. */
function mezclarVersiones(e: Entradas, fondoDb: number): Map<string, AudioBuffer> {
  const salida = new Map<string, AudioBuffer>();
  for (const [version, v] of e.versiones) {
    const { canales } = mezclar({ sr: e.sr, duracion: e.duracion, fondo: e.fondo, voces: e.voces, ...v, fondoDb });
    salida.set(version, crearBuffer(canales, e.sr));
  }
  return salida;
}

/** Descarga las tomas y prepara las entradas de cada versión (una, o una por jugador en solitario). */
async function prepararEntradas(sala: EstadoSala, pack: Pack, alAvanzar: (t: string) => void): Promise<Entradas> {
  const audio = await cargarAudioPack(pack.id);
  const ctx = contexto();
  const sr = ctx.sampleRate;
  const participantes = Object.keys(sala.progreso);
  const versiones = sala.config.modo === 'solitario' ? participantes : [TODOS];
  const fondo = canalesDe(audio.fondo);
  const voces = canalesDe(audio.voces);
  const cacheTomas = new Map<string, Promise<{ sr: number; datos: Float32Array } | null>>();
  const bajarToma = (jugador: string, linea: string) => {
    const clave = `${jugador}/${linea}`;
    let p = cacheTomas.get(clave);
    if (!p) {
      p = fetch(api.urlToma(sala.codigo, sala.ronda, jugador, linea))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => {
          if (!b) return null;
          const w = decodificarWav(b);
          return { sr: w.sr, datos: w.canales[0] };
        })
        .catch(() => null);
      cacheTomas.set(clave, p);
    }
    return p;
  };

  const salida: Entradas['versiones'] = new Map();
  for (const version of versiones) {
    alAvanzar(version === TODOS ? 'Montando el doblaje…' : `Montando la versión de ${sala.jugadores.find((j) => j.id === version)?.nombre ?? '…'}`);
    const tomas: TomaMontaje[] = [];
    const originales: { inicio: number; fin: number }[] = [...(pack.extras ?? [])];
    for (const linea of pack.lineas) {
      const autor = version === TODOS ? sala.asignacion[linea.personaje] : version;
      const t = autor && sala.tomas[autor]?.includes(linea.id) ? await bajarToma(autor, linea.id) : null;
      if (t) tomas.push({ en: linea.inicio - MARGEN_TOMA, datos: t.datos, sr: t.sr, linea: { inicio: linea.inicio, fin: linea.fin } });
      else originales.push({ inicio: linea.inicio, fin: linea.fin });
    }
    salida.set(version, { tomas, originales });
  }
  return { sr, duracion: pack.duracion, fondo, voces, versiones: salida };
}

export function Montaje({ sala, yo }: { sala: EstadoSala; yo: string }) {
  const pack = usePack(sala.config.packId);
  const [entradas, setEntradas] = useState<Entradas | null>(null);
  const [montajes, setMontajes] = useState<Map<string, AudioBuffer> | null>(null);
  const [fondoDb, setFondoDb] = useState(leerFondoDb);
  const [estado, setEstado] = useState('Descargando tomas…');
  const [sonando, setSonando] = useState<string | null>(null);
  const [toast, avisar] = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const repRef = useRef<Reproduccion | null>(null);
  const soyAnfitrion = sala.anfitrion === yo;
  const participantes = Object.keys(sala.progreso);
  const nombre = useCallback((id: string) => sala.jugadores.find((j) => j.id === id)?.nombre ?? '—', [sala.jugadores]);
  const huella = `${sala.ronda}|${JSON.stringify(sala.tomas)}`;

  const primeraMezcla = useRef(true);
  useEffect(() => {
    if (!pack) return;
    let vivo = true;
    setEntradas(null);
    setMontajes(null);
    primeraMezcla.current = true;
    prepararEntradas(sala, pack, (t) => vivo && setEstado(t))
      .then((e) => vivo && setEntradas(e))
      .catch((e) => vivo && setEstado(`Error al montar: ${(e as Error).message}`));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, huella]);

  // Mezcla (y vuelve a mezclar al mover el volumen del fondo)
  useEffect(() => {
    if (!entradas) return;
    const t = setTimeout(() => {
      const m = mezclarVersiones(entradas, fondoDb);
      setMontajes(m);
      (window as unknown as { __dubgameMontajes?: unknown }).__dubgameMontajes = m;
      if (primeraMezcla.current) {
        primeraMezcla.current = false;
        acciones.montajeListo().catch(() => {});
      }
    }, primeraMezcla.current ? 0 : 250);
    try {
      localStorage.setItem('dubgame.fondoDb', String(fondoDb));
    } catch {
      /* sin almacenamiento */
    }
    return () => clearTimeout(t);
  }, [entradas, fondoDb]);

  const parar = () => {
    repRef.current?.parar();
    repRef.current = null;
    setSonando(null);
  };

  const tocar = useCallback(async (version: string, cuando?: number) => {
    const buffer = montajes?.get(version);
    if (!buffer || !pack) return;
    repRef.current?.parar();
    await despertar();
    setSonando(version);
    const rep = await reproducir({ desde: 0, hasta: pack.duracion, pistas: [{ buffer, en: 0 }], video: videoRef.current, cuando });
    repRef.current = rep;
    await rep.terminada;
    if (repRef.current === rep) {
      repRef.current = null;
      setSonando(null);
    }
  }, [montajes, pack]);

  // Reproducción sincronizada lanzada por el anfitrión
  useEffect(() => {
    const play = (r: ReproduccionServidor) => {
      const ctx = contexto();
      const espera = (horaServidorALocal(r.inicioServidor) - performance.now()) / 1000;
      tocar(r.version ?? TODOS, ctx.currentTime + Math.max(0.05, espera));
    };
    const stop = () => parar();
    socket.on('montaje:play', play);
    socket.on('montaje:stop', stop);
    return () => {
      socket.off('montaje:play', play);
      socket.off('montaje:stop', stop);
    };
  }, [tocar]);

  useEffect(() => () => repRef.current?.parar(), []);

  const descargar = async (version: string, formato: 'wav' | 'mp4') => {
    const buffer = montajes?.get(version);
    if (!buffer || !pack) return;
    const wav = codificarWavCanales(canalesDe(buffer), buffer.sampleRate);
    let blob: Blob;
    if (formato === 'mp4') {
      const r = await fetch(`/api/exportar/${pack.id}`, { method: 'POST', body: wav });
      if (!r.ok) {
        avisar((await r.json().catch(() => ({}))).error ?? 'No se pudo generar el vídeo');
        return;
      }
      blob = await r.blob();
    } else {
      blob = new Blob([wav], { type: 'audio/wav' });
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `doblaje-${pack.id}${version === TODOS ? '' : '-' + nombre(version)}.${formato}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  const listos = sala.montajeListo.filter((id) => sala.jugadores.find((j) => j.id === id)?.conectado).length;
  const conectados = sala.jugadores.filter((j) => j.conectado).length;
  const versiones = sala.config.modo === 'solitario' ? participantes : [TODOS];
  const hacer = (p: Promise<unknown>) => p.catch((e: Error) => avisar(e.message));

  const reparto = useMemo(() => {
    if (!pack || sala.config.modo !== 'personajes') return [];
    return pack.personajes.map((p) => ({ p, j: sala.asignacion[p.id] }));
  }, [pack, sala.config.modo, sala.asignacion]);

  if (!pack) return <div className="cargando">CARGANDO…</div>;

  const titulo = sala.fase === 'votacion' ? 'Votación' : sala.fase === 'resultados' ? 'Resultados' : 'El doblaje';
  const rotulo = sonando ? (sonando === TODOS ? 'Doblaje completo' : `Versión de ${nombre(sonando)}`) : null;

  return (
    <div className="escenario" style={{ maxWidth: 1060 }}>
      <Encabezado
        titulo={titulo}
        derecha={soyAnfitrion ? <button className="boton peque" onClick={() => hacer(acciones.nuevaRonda())} data-testid="nueva-ronda">Otra escena</button> : undefined}
      />
      <div className="columnas" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div className="pila">
          <div className="pantalla-video">
            <video ref={videoRef} src={`/packs/${pack.id}/video.mp4`} muted playsInline preload="auto" poster={`/packs/${pack.id}/portada.jpg`} />
            {rotulo && <div className="rec" style={{ background: 'rgba(0,0,0,0.6)' }}>{rotulo}</div>}
          </div>
          {!montajes ? (
            <div className="cargando">{estado.toUpperCase()}</div>
          ) : (
            <div className="fila centro">
              {sonando ? (
                <button className="boton" onClick={() => (soyAnfitrion ? hacer(acciones.pararMontaje()) : parar())}>■ Parar</button>
              ) : sala.config.modo === 'personajes' ? (
                <>
                  {soyAnfitrion && (
                    <button className="boton primario grande" onClick={() => hacer(acciones.reproducirMontaje(null))} data-testid="ver-doblaje">
                      ▶ Ver doblaje (todos)
                    </button>
                  )}
                  <button className="boton" onClick={() => tocar(TODOS)} data-testid="ver-local">▶ Ver solo yo</button>
                </>
              ) : null}
              <button className="boton peque" onClick={() => descargar(versiones.length === 1 ? versiones[0] : sonando ?? versiones[0], 'wav')}>Descargar audio</button>
              <button className="boton peque" onClick={() => descargar(versiones.length === 1 ? versiones[0] : sonando ?? versiones[0], 'mp4')}>Descargar vídeo</button>
            </div>
          )}
          <div className="fila centro" style={{ gap: 12 }}>
            <label className="etiqueta" htmlFor="fondo">Música y efectos</label>
            <input
              id="fondo"
              type="range"
              min={-12}
              max={12}
              step={1}
              value={fondoDb}
              onChange={(e) => setFondoDb(Number(e.target.value))}
              style={{ width: 200 }}
              data-testid="volumen-fondo"
            />
            <span className="tenue" style={{ width: 60 }}>{fondoDb > 0 ? `+${fondoDb}` : fondoDb} dB</span>
          </div>
          <p className="tenue centrado" style={{ fontSize: 15 }}>
            Montajes listos en {listos}/{conectados} dispositivos. Las voces se sincronizan y se igualan de volumen solas.
          </p>
        </div>

        <div className="pila">
          {sala.config.modo === 'personajes' && (
            <Marco titulo="Reparto">
              {reparto.map(({ p, j }) => (
                <div key={p.id} className="fila" style={{ justifyContent: 'space-between', borderLeft: `3px solid ${p.color}`, paddingLeft: 10, marginBottom: 6 }}>
                  <span>{p.nombre}</span>
                  <span className="tenue">{j ? nombre(j) : 'voz original'}</span>
                </div>
              ))}
            </Marco>
          )}

          {sala.config.modo === 'solitario' && (
            <Marco titulo="Versiones">
              {participantes.map((id) => (
                <div key={id} className="fila" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <span>{nombre(id)}{id === yo && <span className="tenue"> (tú)</span>}</span>
                  <span className="fila" style={{ gap: 4 }}>
                    {soyAnfitrion && (
                      <button className="boton peque" disabled={!montajes} onClick={() => hacer(acciones.reproducirMontaje(id))} title="Para todos">▶ Todos</button>
                    )}
                    <button className="boton peque fantasma" disabled={!montajes} onClick={() => tocar(id)} title="Solo en tu pantalla">▶ Yo</button>
                  </span>
                </div>
              ))}
              {sala.fase === 'montaje' && soyAnfitrion && participantes.length >= 2 && (
                <button className="boton primario mt" onClick={() => hacer(acciones.empezarVotacion())} data-testid="empezar-votacion">
                  Pasar a votar
                </button>
              )}
            </Marco>
          )}

          {sala.fase === 'votacion' && (
            <Marco titulo="¿Quién lo ha bordado?">
              {participantes.includes(yo) ? (
                <div className="pila" style={{ gap: 6 }}>
                  {participantes.filter((id) => id !== yo).map((id) => (
                    <button
                      key={id}
                      className={`boton ${sala.votos[yo] === id ? 'primario' : ''}`}
                      onClick={() => hacer(acciones.votar(id))}
                      data-testid={`votar-${nombre(id)}`}
                    >
                      {nombre(id)}
                    </button>
                  ))}
                  <p className="tenue" style={{ fontSize: 15 }}>
                    Votos: {Object.keys(sala.votos).length}/{participantes.filter((id) => sala.jugadores.find((j) => j.id === id)?.conectado).length}
                  </p>
                </div>
              ) : (
                <p className="tenue">Esta ronda no participabas.</p>
              )}
            </Marco>
          )}

          {sala.fase === 'resultados' && (
            <Marco titulo="Marcador">
              <div className="podio" data-testid="marcador">
                {[...sala.jugadores].sort((a, b) => b.puntos - a.puntos).map((j, i) => (
                  <div className="puesto" key={j.id}>
                    <span className="n">{i + 1}</span>
                    <span>{j.nombre} {sala.recuento[j.id] ? <span className="tenue">(+{sala.recuento[j.id]})</span> : null}</span>
                    <span className="cinzel">{j.puntos}</span>
                  </div>
                ))}
              </div>
            </Marco>
          )}
          {!soyAnfitrion && <p className="tenue" style={{ fontSize: 15 }}>El anfitrión controla la reproducción para todos.</p>}
        </div>
      </div>
      {toast}
    </div>
  );
}
