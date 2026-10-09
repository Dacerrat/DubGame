import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Motor = typeof import('../../client/src/audio/motor');

/** localStorage de mentira (en Node no hay). */
function almacen(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, String(v)),
    removeItem: (k: string) => void datos.delete(k),
  };
}

/** localStorage que falla siempre (modo privado, cookies bloqueadas...). */
const roto = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

/** El motor guarda el volumen en memoria: cada prueba lo carga de cero. */
async function cargarMotor(): Promise<Motor> {
  vi.resetModules();
  return import('../../client/src/audio/motor');
}

const db = (g: number) => 20 * Math.log10(g);

describe('volumen: conversiones', () => {
  let m: Motor;
  beforeEach(async () => {
    vi.stubGlobal('localStorage', almacen());
    m = await cargarMotor();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('limita el volumen a 0–200 % y lo que no es un número vale 100 %', () => {
    expect(m.limitarVolumen(-0.5)).toBe(0);
    expect(m.limitarVolumen(0.7)).toBe(0.7);
    expect(m.limitarVolumen(3)).toBe(2);
    expect(m.limitarVolumen(NaN)).toBe(1);
    expect(m.limitarVolumen(Infinity)).toBe(1);
  });

  it('porcentaje ↔ volumen, redondeando al 1 % y sin salirse del rango', () => {
    expect(m.porcentajeAVolumen(150)).toBe(1.5);
    expect(m.porcentajeAVolumen(37.4)).toBe(0.37);
    expect(m.porcentajeAVolumen(250)).toBe(2);
    expect(m.porcentajeAVolumen(-10)).toBe(0);
    expect(m.volumenAPorcentaje(1.234)).toBe(123);
    expect(m.volumenAPorcentaje(5)).toBe(200);
    for (let p = 0; p <= 200; p += 5) expect(m.volumenAPorcentaje(m.porcentajeAVolumen(p))).toBe(p);
  });

  it('la ganancia: 100 % no cambia nada, 200 % = +6 dB, 50 % = −12 dB y 0 % = silencio', () => {
    expect(m.gananciaDeVolumen(1)).toBe(1);
    expect(db(m.gananciaDeVolumen(2))).toBeCloseTo(6.02, 1);
    expect(db(m.gananciaDeVolumen(0.5))).toBeCloseTo(-12.04, 1);
    expect(m.gananciaDeVolumen(0)).toBe(0);
    expect(m.gananciaDeVolumen(9)).toBe(2);
  });

  it('la ganancia siempre crece con el volumen', () => {
    let anterior = -1;
    for (let p = 0; p <= 200; p += 5) {
      const g = m.gananciaDeVolumen(m.porcentajeAVolumen(p));
      expect(g).toBeGreaterThan(anterior);
      anterior = g;
    }
  });
});

describe('volumen: se recuerda', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sin nada guardado empieza al 100 %', async () => {
    vi.stubGlobal('localStorage', almacen());
    const m = await cargarMotor();
    expect(m.volumen()).toBe(1);
  });

  it('guarda cada cambio y lo recupera al volver', async () => {
    const ls = almacen();
    vi.stubGlobal('localStorage', ls);
    let m = await cargarMotor();
    m.cambiarVolumen(1.456);
    expect(m.volumen()).toBe(1.46);
    expect(ls.datos.get('dubgame.volumen')).toBe('1.46');
    m = await cargarMotor();
    expect(m.volumen()).toBe(1.46);
  });

  it('valores guardados raros: se limitan o vuelven al 100 %', async () => {
    for (const [guardado, esperado] of [['5', 2], ['-1', 0], ['0', 0], ['abc', 1], ['', 1], ['  ', 1]] as const) {
      vi.stubGlobal('localStorage', almacen({ 'dubgame.volumen': guardado }));
      const m = await cargarMotor();
      expect(m.volumen(), `guardado: "${guardado}"`).toBe(esperado);
    }
  });

  it('si el almacenamiento falla, funciona igual (100 % y cambios en memoria)', async () => {
    vi.stubGlobal('localStorage', roto);
    const m = await cargarMotor();
    expect(m.volumen()).toBe(1);
    expect(() => m.cambiarVolumen(0.4)).not.toThrow();
    expect(m.volumen()).toBe(0.4);
  });

  it('si ni siquiera existe localStorage, también', async () => {
    vi.stubGlobal('localStorage', undefined);
    const m = await cargarMotor();
    expect(m.volumenGuardado()).toBe(1);
    expect(() => m.cambiarVolumen(1.2)).not.toThrow();
    expect(m.volumen()).toBe(1.2);
  });
});

describe('volumen: todos los controles a la vez', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('avisa a cada suscriptor solo cuando cambia, y deja de avisar al desuscribirse', async () => {
    vi.stubGlobal('localStorage', almacen());
    const m = await cargarMotor();
    const a: number[] = [];
    const b: number[] = [];
    const quitarA = m.suscribirVolumen((v) => a.push(v));
    m.suscribirVolumen((v) => b.push(v));
    m.cambiarVolumen(0.5);
    m.cambiarVolumen(0.5); // igual: no avisa
    m.cambiarVolumen(7); // se limita a 200 %
    m.cambiarVolumen(NaN); // se ignora
    quitarA();
    m.cambiarVolumen(1);
    expect(a).toEqual([0.5, 2]);
    expect(b).toEqual([0.5, 2, 1]);
  });
});
