import { describe, expect, it } from 'vitest';
import { OBJETIVO_VOZ_DB, db, deteccionVoz, limitar, normalizarVoz, puntoDeCorte, rmsConPuerta } from '../../client/src/audio/dsp';
import { MARGEN_TOMA, colocarToma, mezclar } from '../../client/src/audio/mezcla';
import { calcularRetraso } from '../../client/src/ui/Calibracion';
import { tono } from '../../client/src/audio/tono';
import { codificarWav, decodificarWav } from '../../client/src/audio/wav';

const SR = 16000;
function voz(dbfs: number, seg: number, f = 220): Float32Array {
  // "Voz" sintética: tono modulado con pausas, a un nivel RMS dado
  const n = Math.round(seg * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const silabas = Math.sin(2 * Math.PI * 3 * t) > -0.3 ? 1 : 0;
    x[i] = silabas * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * 2.5 * f * t));
  }
  const nivel = rmsConPuerta(x, SR);
  const g = Math.pow(10, (dbfs - nivel) / 20);
  return x.map((v) => v * g);
}

describe('normalización de voces', () => {
  it('una toma flojita y una fuerte acaban al mismo nivel (±1 dB)', () => {
    const floja = normalizarVoz(voz(-40, 3), SR);
    const fuerte = normalizarVoz(voz(-10, 3, 180), SR);
    expect(Math.abs(rmsConPuerta(floja.datos, SR) - OBJETIVO_VOZ_DB)).toBeLessThan(1);
    expect(Math.abs(rmsConPuerta(fuerte.datos, SR) - OBJETIVO_VOZ_DB)).toBeLessThan(1);
  });
  it('no amplifica el silencio', () => {
    const r = normalizarVoz(new Float32Array(SR), SR);
    expect(r.gananciaDb).toBe(0);
  });
  it('la ganancia está limitada a +24 dB', () => {
    const r = normalizarVoz(voz(-70, 2), SR);
    expect(r.gananciaDb).toBeLessThanOrEqual(24);
  });
});

describe('limitador', () => {
  it('nunca deja pasar picos por encima del techo', () => {
    const L = voz(-3, 2).map((v) => v * 3);
    const R = L.slice();
    limitar([L, R], SR, -1);
    const pico = Math.max(...L.map(Math.abs));
    expect(db(pico)).toBeLessThanOrEqual(-0.99);
  });
});

describe('mezcla', () => {
  it('coloca cada toma en su sitio y equilibra los volúmenes', () => {
    const dur = 6;
    const silencio = new Float32Array(dur * SR);
    const vocesOrig = new Float32Array(dur * SR);
    vocesOrig.set(voz(-20, 1), 4 * SR);
    const { canales, info } = mezclar({
      sr: SR,
      duracion: dur,
      fondo: [silencio, silencio],
      voces: [vocesOrig],
      tomas: [
        { en: 0.5, datos: voz(-38, 1), sr: SR },
        { en: 2.5, datos: voz(-8, 1, 170), sr: SR },
      ],
      originales: [{ inicio: 4, fin: 5 }],
    });
    const L = canales[0];
    const tramo = (a: number, b: number) => rmsConPuerta(L.subarray(a * SR, b * SR), SR);
    // Antes de la primera toma: silencio
    expect(tramo(0, 0.45)).toBeLessThan(-80);
    const n1 = tramo(0.5, 1.5);
    const n2 = tramo(2.5, 3.5);
    const n3 = tramo(4, 5);
    expect(Math.abs(n1 - n2)).toBeLessThan(1.5);
    expect(Math.abs(n1 - n3)).toBeLessThan(1.5);
    expect(info.nivelesTomasDb.every((n) => Math.abs(n - OBJETIVO_VOZ_DB) < 1)).toBe(true);
  });

  it('remuestrea tomas grabadas a otra frecuencia', () => {
    const { canales } = mezclar({
      sr: SR, duracion: 2, fondo: [new Float32Array(2 * SR)], voces: [new Float32Array(2 * SR)],
      tomas: [{ en: 0, datos: new Float32Array(48000).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 300 * i) / 48000)), sr: 48000 }], originales: [],
    });
    // 1 s a 48 kHz -> 1 s a 16 kHz
    expect(rmsConPuerta(canales[0].subarray(Math.round(0.8 * SR), Math.round(0.95 * SR)), SR)).toBeGreaterThan(-30);
    expect(canales[0][Math.round(1.2 * SR)]).toBe(0);
  });
});

describe('wav', () => {
  it('ida y vuelta conserva la señal', () => {
    const x = voz(-12, 0.5);
    const { sr, canales } = decodificarWav(codificarWav(x, SR));
    expect(sr).toBe(SR);
    expect(canales[0].length).toBe(x.length);
    let err = 0;
    for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(x[i] - canales[0][i]));
    expect(err).toBeLessThan(1e-3);
  });
});

describe('sincronización automática de tomas', () => {
  const silencio = (seg: number) => new Float32Array(Math.round(seg * SR));
  const unir = (...partes: Float32Array[]) => {
    const out = new Float32Array(partes.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of partes) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  it('detecta dónde empieza y acaba la voz', () => {
    const x = unir(silencio(0.7), voz(-20, 1.5), silencio(0.8));
    const d = deteccionVoz(x, SR)!;
    expect(Math.abs(d.inicio - 0.7)).toBeLessThan(0.04);
    expect(Math.abs(d.fin - 2.2)).toBeLessThan(0.15);
    expect(deteccionVoz(silencio(1), SR)).toBeNull();
  });

  it('una toma que empieza tarde se coloca donde empieza la voz original', () => {
    // Voz original: empieza en t = 2.0 s (la línea va de 1.92 a 3.6)
    const vocesOrig = unir(silencio(2.0), voz(-18, 1.5), silencio(1.5));
    // El jugador habla 0.9 s después de empezar la grabación, que empezó en inicio - MARGEN_TOMA
    const linea = { inicio: 1.92, fin: 3.6 };
    const toma = { en: linea.inicio - MARGEN_TOMA, datos: unir(silencio(0.6 + 0.9), voz(-25, 1.2), silencio(1)), sr: SR, linea };
    const c = colocarToma(toma, [vocesOrig], SR);
    const empiezaVoz = c.en + deteccionVoz(c.datos, SR)!.inicio;
    expect(Math.abs(empiezaVoz - 2.0)).toBeLessThan(0.05);
    // Se recortan los silencios: la toma colocada dura poco más que la voz
    expect(c.datos.length / SR).toBeLessThan(1.6);
  });

  it('sin línea o sin voz, la toma se queda como está', () => {
    const t = { en: 1, datos: silencio(1), sr: SR };
    expect(colocarToma(t, null, SR).en).toBe(1);
  });
});

describe('calibración de sincronía', () => {
  it('mide el retraso típico de unos auriculares Bluetooth', () => {
    const clics = Array.from({ length: 10 }, (_, k) => 1 + k * 0.6);
    // pulsa ~250 ms tarde con algo de variación; falla uno
    const pulsaciones = clics.slice(1).map((c, k) => c + 0.25 + (k % 3 - 1) * 0.02);
    expect(calcularRetraso(clics, pulsaciones)).toBeCloseTo(0.25, 2);
  });
  it('sin suficientes pulsaciones no inventa nada', () => {
    expect(calcularRetraso([1, 1.6, 2.2], [1.1, 1.7])).toBeNull();
  });
});

describe('entonación', () => {
  it('detecta el tono de una voz sintética y nada en el silencio', () => {
    const sr = 16000;
    const x = new Float32Array(sr);
    for (let i = 0; i < sr / 2; i++) {
      const t = i / sr;
      x[i] = 0.5 * Math.sin(2 * Math.PI * 150 * t) + 0.25 * Math.sin(2 * Math.PI * 300 * t) + 0.1 * Math.sin(2 * Math.PI * 450 * t);
    }
    const p = tono(x, sr);
    expect(p.length).toBeGreaterThan(20);
    const medio = p.map((q) => q.hz).sort((a, b) => a - b)[Math.floor(p.length / 2)];
    expect(Math.abs(medio - 150)).toBeLessThan(8);
    expect(p.every((q) => q.t < 0.55)).toBe(true);
  });
});

describe('dividir una línea', () => {
  it('corta en el centro de la pausa más larga', () => {
    const sr = 16000;
    const x = new Float32Array(sr * 4);
    // voz de 0,2 a 1,6 s, pausa corta (0,15 s), voz hasta 2,2 s, pausa larga (0,5 s), voz hasta 3,8 s
    const voz = (a: number, b: number) => {
      for (let i = Math.floor(a * sr); i < b * sr; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 180 * i) / sr);
    };
    voz(0.2, 1.6);
    voz(1.75, 2.2);
    voz(2.7, 3.8);
    expect(puntoDeCorte([x], sr, 0, 4)).toBeCloseTo(2.45, 1);
  });
  it('sin pausas, por la mitad', () => {
    const sr = 16000;
    const x = Float32Array.from({ length: sr * 2 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 200 * i) / sr));
    expect(puntoDeCorte([x], sr, 0, 2)).toBeCloseTo(1, 5);
  });
});
