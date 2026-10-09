// Calibración de la sincronía: suenan clics y el jugador pulsa a la vez.
// Mide el retraso real de su salida de audio (p. ej. auriculares Bluetooth)
// que el navegador no conoce, y lo guarda para sincronizar vídeo, subtítulos y tomas.
import { useEffect, useRef, useState } from 'react';
import { despertar, guardarLatenciaExtra, latenciaExtra } from '../audio/motor';

const CLICS = 10;
const INTERVALO = 0.6;
const IGNORAR = 2; // los primeros clics sirven para coger el ritmo

/** Hora del contexto que "suena" en el instante `ts` (performance.now). */
function horaAudible(ctx: AudioContext, ts: number): number {
  const o = ctx.getOutputTimestamp?.();
  if (o && o.performanceTime !== undefined && o.contextTime !== undefined && o.performanceTime > 0) {
    return o.contextTime + (ts - o.performanceTime) / 1000;
  }
  return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0) + (ts - performance.now()) / 1000;
}

export function mediana(xs: number[]): number {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/** Retraso extra (s) a partir de las horas de los clics y de las pulsaciones. */
export function calcularRetraso(clics: number[], pulsaciones: number[]): number | null {
  const desfases: number[] = [];
  for (const p of pulsaciones) {
    let mejor = -1;
    for (let k = 0; k < clics.length; k++) if (mejor < 0 || Math.abs(p - clics[k]) < Math.abs(p - clics[mejor])) mejor = k;
    const d = p - clics[mejor];
    if (mejor >= IGNORAR && Math.abs(d) <= INTERVALO / 2) desfases.push(d);
  }
  if (desfases.length < 5) return null;
  return Math.max(0, Math.min(0.6, mediana(desfases)));
}

export function Calibracion({ alTerminar }: { alTerminar?: () => void }) {
  const [fase, setFase] = useState<'inicio' | 'midiendo' | 'resultado'>('inicio');
  const [resultado, setResultado] = useState<number | null>(null);
  const [pulsadas, setPulsadas] = useState(0);
  const clics = useRef<number[]>([]);
  const toques = useRef<number[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const actual = latenciaExtra();

  const tocar = (ts: number) => {
    const ctx = ctxRef.current;
    if (!ctx || fase !== 'midiendo') return;
    toques.current.push(horaAudible(ctx, ts));
    setPulsadas((n) => n + 1);
  };

  useEffect(() => {
    if (fase !== 'midiendo') return;
    const f = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        tocar(e.timeStamp);
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  });

  const empezar = async () => {
    const ctx = await despertar();
    ctxRef.current = ctx;
    clics.current = [];
    toques.current = [];
    setPulsadas(0);
    const t0 = ctx.currentTime + 1;
    for (let k = 0; k < CLICS; k++) {
      const t = t0 + k * INTERVALO;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = 1500;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
      clics.current.push(t);
    }
    setFase('midiendo');
    setTimeout(() => {
      setResultado(calcularRetraso(clics.current, toques.current));
      setFase('resultado');
    }, (1 + CLICS * INTERVALO + 0.6) * 1000);
  };

  return (
    <div className="calibracion">
      {fase === 'inicio' && (
        <>
          <p style={{ margin: 0 }}>
            Ponte los auriculares que vayas a usar. Sonarán {CLICS} clics: pulsa <kbd>Espacio</kbd> (o toca el botón) justo cuando oigas cada uno.
          </p>
          <p className="tenue" style={{ margin: '6px 0 0', fontSize: 15 }}>
            Ajuste actual: {Math.round(actual * 1000)} ms
          </p>
          <div className="fila fin mt">
            {alTerminar && <button className="boton peque fantasma" onClick={alTerminar}>Cancelar</button>}
            <button className="boton" onClick={empezar}>Empezar</button>
          </div>
        </>
      )}
      {fase === 'midiendo' && (
        <button
          className="boton grande primario"
          style={{ width: '100%', padding: '28px 0' }}
          onPointerDown={(e) => tocar(e.timeStamp)}
        >
          ¡Pulsa con cada clic! ({pulsadas})
        </button>
      )}
      {fase === 'resultado' && (
        <>
          {resultado === null ? (
            <p className="aviso">No se han registrado suficientes pulsaciones a tiempo. Prueba otra vez.</p>
          ) : (
            <p>
              Retraso de tu audio: <b className="cinzel">{Math.round(resultado * 1000)} ms</b>
              {resultado < 0.04 ? ' (perfecto, no hace falta ajuste).' : '. Se compensará en el vídeo, los subtítulos y tus tomas.'}
            </p>
          )}
          <div className="fila fin">
            <button className="boton peque fantasma" onClick={() => { guardarLatenciaExtra(0); alTerminar?.(); setFase('inicio'); }}>Quitar ajuste</button>
            <button className="boton peque" onClick={() => setFase('inicio')}>Repetir</button>
            {resultado !== null && (
              <button className="boton peque primario" onClick={() => { guardarLatenciaExtra(resultado); alTerminar?.(); setFase('inicio'); }}>
                Guardar
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
