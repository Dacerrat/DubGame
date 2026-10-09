import { describe, expect, it } from 'vitest';
import { OBJETIVO_VOZ_DB, db, limitar, normalizarVoz, rmsConPuerta } from '../../client/src/audio/dsp';
import { mezclar } from '../../client/src/audio/mezcla';
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
