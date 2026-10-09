// Procesado de audio en JS puro (sin Web Audio) para que sea determinista y testeable.

export const OBJETIVO_VOZ_DB = -18;

export function db(x: number): number {
  return 20 * Math.log10(Math.max(x, 1e-12));
}

export function desdeDb(d: number): number {
  return Math.pow(10, d / 20);
}

/** Filtro paso alto biquad (RBJ), devuelve una copia. */
export function pasoAlto(x: Float32Array, sr: number, fc = 80, q = Math.SQRT1_2): Float32Array {
  const w0 = (2 * Math.PI * fc) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    y[i] = yi;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
  }
  return y;
}

/**
 * Sonoridad aproximada (dBFS) con puerta, al estilo LUFS:
 * bloques de 50 ms, se descartan los que están por debajo de -50 dBFS
 * y luego los que quedan 20 dB por debajo de la media de los activos.
 */
export function rmsConPuerta(x: Float32Array, sr: number): number {
  const bloque = Math.max(1, Math.round(sr * 0.05));
  const energias: number[] = [];
  for (let i = 0; i + bloque <= x.length; i += bloque) {
    let s = 0;
    for (let k = i; k < i + bloque; k++) s += x[k] * x[k];
    energias.push(s / bloque);
  }
  if (energias.length === 0) {
    let s = 0;
    for (let k = 0; k < x.length; k++) s += x[k] * x[k];
    return db(Math.sqrt(s / Math.max(1, x.length)));
  }
  const umbralAbs = desdeDb(-50) ** 2;
  let activos = energias.filter((e) => e > umbralAbs);
  if (activos.length === 0) return -120;
  const media = activos.reduce((a, b) => a + b, 0) / activos.length;
  const umbralRel = media * desdeDb(-20) ** 2;
  activos = activos.filter((e) => e > umbralRel);
  return db(Math.sqrt(activos.reduce((a, b) => a + b, 0) / activos.length));
}

export function fundidos(x: Float32Array, sr: number, seg = 0.01): Float32Array {
  const n = Math.min(Math.floor(sr * seg), Math.floor(x.length / 2));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
  return x;
}

export interface ResultadoNormalizar {
  datos: Float32Array;
  gananciaDb: number;
  nivelDb: number;
}

/** Normaliza una toma de voz: paso alto, ganancia a objetivo y fundidos. */
export function normalizarVoz(
  x: Float32Array,
  sr: number,
  objetivoDb = OBJETIVO_VOZ_DB,
  limites: [number, number] = [-12, 24],
): ResultadoNormalizar {
  const filtrada = pasoAlto(x, sr);
  const nivel = rmsConPuerta(filtrada, sr);
  // Una toma en silencio no se amplifica
  const ganancia = nivel <= -90 ? 0 : Math.min(limites[1], Math.max(limites[0], objetivoDb - nivel));
  const g = desdeDb(ganancia);
  for (let i = 0; i < filtrada.length; i++) filtrada[i] *= g;
  return { datos: fundidos(filtrada, sr), gananciaDb: ganancia, nivelDb: nivel };
}

/** Remuestreo lineal (suficiente para voz). */
export function remuestrear(x: Float32Array, srOrigen: number, srDestino: number): Float32Array {
  if (srOrigen === srDestino) return x;
  const n = Math.round((x.length * srDestino) / srOrigen);
  const y = new Float32Array(n);
  const paso = srOrigen / srDestino;
  for (let i = 0; i < n; i++) {
    const pos = i * paso;
    const k = Math.floor(pos);
    const f = pos - k;
    const a = x[k] ?? 0;
    const b = x[k + 1] ?? a;
    y[i] = a + (b - a) * f;
  }
  return y;
}

/** Compresor feed-forward sencillo (in situ, mono). */
export function comprimir(
  x: Float32Array,
  sr: number,
  { umbralDb = -24, ratio = 3, ataque = 0.005, relajacion = 0.12, compensacionDb = 3 } = {},
): Float32Array {
  const aA = Math.exp(-1 / (sr * ataque));
  const aR = Math.exp(-1 / (sr * relajacion));
  let env = 0;
  const comp = desdeDb(compensacionDb);
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    env = v > env ? aA * env + (1 - aA) * v : aR * env + (1 - aR) * v;
    const nivel = db(env);
    const reduccion = nivel > umbralDb ? (nivel - umbralDb) * (1 - 1 / ratio) : 0;
    x[i] *= desdeDb(-reduccion) * comp;
  }
  return x;
}

/** Limitador estéreo con anticipación por bloques (in situ). Techo en dBFS. */
export function limitar(canales: Float32Array[], sr: number, techoDb = -1): void {
  const techo = desdeDb(techoDb);
  const n = canales[0].length;
  const bloque = 64;
  const nb = Math.ceil(n / bloque);
  const necesaria = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    let pico = 0;
    for (const c of canales) {
      for (let i = b * bloque; i < Math.min(n, (b + 1) * bloque); i++) pico = Math.max(pico, Math.abs(c[i]));
    }
    necesaria[b] = pico > techo ? techo / pico : 1;
  }
  // Anticipación: cada bloque usa el mínimo de sí mismo y los siguientes
  const ant = 3;
  const g = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    let m = 1;
    for (let k = Math.max(0, b - 1); k <= Math.min(nb - 1, b + ant); k++) m = Math.min(m, necesaria[k]);
    g[b] = m;
  }
  // Relajación suave (el ataque ya lo cubre la anticipación)
  const rel = Math.exp(-bloque / (sr * 0.08));
  for (let b = 1; b < nb; b++) if (g[b] > g[b - 1]) g[b] = g[b - 1] + (g[b] - g[b - 1]) * (1 - rel);
  for (const c of canales) {
    for (let b = 0; b < nb; b++) {
      const g0 = g[b];
      const g1 = b + 1 < nb ? g[b + 1] : g0;
      const ini = b * bloque;
      const fin = Math.min(n, ini + bloque);
      for (let i = ini; i < fin; i++) {
        c[i] *= g0 + ((g1 - g0) * (i - ini)) / bloque;
        // Red de seguridad: nunca por encima del techo
        if (c[i] > techo) c[i] = techo;
        else if (c[i] < -techo) c[i] = -techo;
      }
    }
  }
}

export function aMono(canales: Float32Array[]): Float32Array {
  if (canales.length === 1) return canales[0];
  const n = canales[0].length;
  const y = new Float32Array(n);
  for (const c of canales) for (let i = 0; i < n; i++) y[i] += c[i] / canales.length;
  return y;
}
