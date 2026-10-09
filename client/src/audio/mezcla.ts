// Montaje final: fondo + tomas normalizadas + compresor + limitador (JS puro).
import { OBJETIVO_VOZ_DB, aMono, comprimir, deteccionVoz, desdeDb, fundidos, limitar, normalizarVoz, remuestrear, rmsConPuerta } from './dsp';

/** Las tomas se graban desde este margen (s) antes del inicio de la línea. */
export const MARGEN_TOMA = 0.6;

export interface TomaMontaje {
  /** Momento del clip (s) en el que empieza el audio de la toma. */
  en: number;
  datos: Float32Array;
  sr: number;
  /** Línea doblada: si se indica, la toma se sincroniza sola con la voz original. */
  linea?: { inicio: number; fin: number };
}

/**
 * Sincronización automática de una toma: recorta los silencios del principio y del
 * final y la desplaza para que la voz empiece donde empezaba la voz original.
 * Así da igual que el jugador arranque un poco tarde o que sus auriculares
 * (p. ej. Bluetooth) tengan retraso.
 */
export function colocarToma(
  t: TomaMontaje,
  vocesOriginales: Float32Array[] | null,
  srVoces: number,
): { datos: Float32Array; en: number } {
  const voz = deteccionVoz(t.datos, t.sr);
  if (!voz || !t.linea) return { datos: t.datos, en: t.en };
  let objetivo = t.linea.inicio + 0.08; // margen que deja el motor antes de la voz
  if (vocesOriginales) {
    const ini = Math.max(0, t.linea.inicio - 0.15);
    const orig = deteccionVoz(trozo(vocesOriginales, srVoces, ini, t.linea.fin + 0.1), srVoces);
    if (orig) objetivo = ini + orig.inicio;
  }
  const desplazamiento = Math.max(-1.5, Math.min(0.6, objetivo - (t.en + voz.inicio)));
  const a = Math.max(0, Math.round((voz.inicio - 0.06) * t.sr));
  const b = Math.min(t.datos.length, Math.round((voz.fin + 0.25) * t.sr));
  const datos = fundidos(t.datos.slice(a, b), t.sr, 0.015);
  return { datos, en: t.en + a / t.sr + desplazamiento };
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
    const colocada = colocarToma(t, e.voces, e.sr);
    const datos = remuestrear(colocada.datos, t.sr, e.sr);
    const r = normalizarVoz(datos, e.sr);
    niveles.push(r.nivelDb + r.gananciaDb);
    sumar(r.datos, colocada.en);
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
    : Math.max(-12, Math.min(12, OBJETIVO_VOZ_DB - nivelVocesOrig)) + (e.fondoDb ?? 0);
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
  // Volumen final: el montaje se lleva a un nivel alto y homogéneo (~-14 dBFS)
  const nivel = rmsConPuerta(L, e.sr);
  if (nivel > -90) {
    const g = desdeDb(Math.max(-6, Math.min(12, -14 - nivel)));
    for (let i = 0; i < n; i++) {
      L[i] *= g;
      R[i] *= g;
    }
  }
  limitar([L, R], e.sr, -1);
  return { canales: [L, R], info: { gananciaFondoDb: gFondoDb, nivelesTomasDb: niveles } };
}
