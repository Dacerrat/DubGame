// Montaje final: fondo + tomas normalizadas + compresor + limitador (JS puro).
import { OBJETIVO_VOZ_DB, aMono, comprimir, desdeDb, limitar, normalizarVoz, remuestrear, rmsConPuerta } from './dsp';

export interface TomaMontaje {
  /** Momento del clip (s) en el que empieza el audio de la toma. */
  en: number;
  datos: Float32Array;
  sr: number;
}

export interface EntradaMezcla {
  sr: number;
  duracion: number;
  fondo: Float32Array[]; // 1 o 2 canales a `sr`
  voces: Float32Array[]; // voces originales aisladas a `sr`
  tomas: TomaMontaje[];
  /** Tramos (s) en los que se usa la voz original (líneas sin toma y extras). */
  originales: { inicio: number; fin: number }[];
  /** Ajuste del fondo en dB respecto al equilibrio original. */
  fondoDb?: number;
}

export interface InfoMezcla {
  gananciaFondoDb: number;
  nivelesTomasDb: number[];
}

function trozo(canales: Float32Array[], sr: number, ini: number, fin: number): Float32Array {
  const a = Math.max(0, Math.floor(ini * sr));
  const b = Math.min(canales[0].length, Math.ceil(fin * sr));
  return aMono(canales.map((c) => c.subarray(a, Math.max(a, b))));
}

export function mezclar(e: EntradaMezcla): { canales: [Float32Array, Float32Array]; info: InfoMezcla } {
  const n = Math.ceil(e.duracion * e.sr);
  const bus = new Float32Array(n);
  const niveles: number[] = [];

  const sumar = (datos: Float32Array, en: number) => {
    const o = Math.round(en * e.sr);
    for (let i = 0; i < datos.length; i++) {
      const k = o + i;
      if (k >= 0 && k < n) bus[k] += datos[i];
    }
  };

  for (const t of e.tomas) {
    const datos = remuestrear(t.datos, t.sr, e.sr);
    const r = normalizarVoz(datos, e.sr);
    niveles.push(r.nivelDb + r.gananciaDb);
    sumar(r.datos, t.en);
  }
  for (const o of e.originales) {
    const ini = Math.max(0, o.inicio - 0.05);
    const datos = trozo(e.voces, e.sr, ini, o.fin + 0.05);
    if (datos.length > 0) sumar(normalizarVoz(new Float32Array(datos), e.sr).datos, ini);
  }
  comprimir(bus, e.sr);

  // El fondo conserva el equilibrio original con las voces: se le aplica la
  // misma ganancia que necesitarían las voces originales para llegar al objetivo.
  const nivelVocesOrig = rmsConPuerta(aMono(e.voces), e.sr);
  const gFondoDb = nivelVocesOrig <= -90
    ? 0
    : Math.max(-12, Math.min(12, OBJETIVO_VOZ_DB - nivelVocesOrig)) + (e.fondoDb ?? -2);
  const gFondo = desdeDb(gFondoDb);

  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const fL = e.fondo[0];
  const fR = e.fondo[1] ?? e.fondo[0];
  for (let i = 0; i < n; i++) {
    const v = bus[i];
    L[i] = v + (fL[i] ?? 0) * gFondo;
    R[i] = v + (fR[i] ?? 0) * gFondo;
  }
  limitar([L, R], e.sr, -1);
  return { canales: [L, R], info: { gananciaFondoDb: gFondoDb, nivelesTomasDb: niveles } };
}
