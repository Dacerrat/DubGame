// Detección de tono (frecuencia fundamental) para dibujar la entonación.
// Autocorrelación normalizada sobre la señal reducida a ~8 kHz: barata y
// suficiente para voz hablada (70-400 Hz).

export interface PuntoTono {
  t: number; // segundos desde el inicio de la señal
  hz: number;
}

const SR_TONO = 8000;

function reducir(x: Float32Array, sr: number): Float32Array {
  const r = Math.max(1, Math.round(sr / SR_TONO));
  const n = Math.floor(x.length / r);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < r; k++) s += x[i * r + k];
    y[i] = s / r;
  }
  return y;
}

export function tono(x: Float32Array, sr: number, { minHz = 70, maxHz = 400, umbral = 0.6 } = {}): PuntoTono[] {
  const y = reducir(x, sr);
  const srY = sr / Math.max(1, Math.round(sr / SR_TONO));
  const marco = Math.round(0.032 * srY);
  const salto = Math.round(0.01 * srY);
  const lMin = Math.floor(srY / maxHz);
  const lMax = Math.ceil(srY / minHz);
  const nMarcos = Math.max(0, Math.floor((y.length - marco - lMax - 1) / salto));
  // Energía por marco para descartar silencios
  const energias = new Float32Array(nMarcos);
  let maxE = 0;
  for (let f = 0; f < nMarcos; f++) {
    let e = 0;
    for (let i = f * salto; i < f * salto + marco; i++) e += y[i] * y[i];
    energias[f] = e;
    maxE = Math.max(maxE, e);
  }
  const puntos: PuntoTono[] = [];
  for (let f = 0; f < nMarcos; f++) {
    if (energias[f] < maxE * 0.02 || energias[f] === 0) continue;
    const a = f * salto;
    const r = new Float32Array(lMax + 2);
    let rMax = 0;
    for (let l = lMin; l <= lMax + 1; l++) {
      let s = 0, e1 = 0, e2 = 0;
      for (let i = 0; i < marco; i++) {
        const u = y[a + i];
        const v = y[a + i + l];
        s += u * v;
        e1 += u * u;
        e2 += v * v;
      }
      r[l] = s / Math.sqrt(e1 * e2 + 1e-12);
      if (l <= lMax) rMax = Math.max(rMax, r[l]);
    }
    // El primer pico casi tan alto como el máximo (evita errores de octava)
    let mejorL = -1;
    if (rMax >= umbral) {
      for (let l = lMin + 1; l <= lMax; l++) {
        if (r[l] >= 0.9 * rMax && r[l] >= r[l - 1] && r[l] >= r[l + 1]) {
          mejorL = l;
          break;
        }
      }
    }
    if (mejorL > 0) puntos.push({ t: (a + marco / 2) / srY, hz: srY / mejorL });
  }
  return puntos;
}
