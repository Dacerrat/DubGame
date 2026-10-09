import { describe, expect, it } from 'vitest';
import { dividirTexto, filtrarPacks, lineasDeJugador, packJugable, repartir, rotar, validarPack } from '../../shared/reglas';
import type { Pack } from '../../shared/tipos';

const p = (n: number) => ({ personajes: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, nombre: `P${i}`, color: '#fff' })) });

describe('filtrado de packs', () => {
  it('en modo personajes exige tantos personajes como jugadores', () => {
    expect(packJugable(p(3), 'personajes', 3)).toBe(true);
    expect(packJugable(p(2), 'personajes', 3)).toBe(false);
    expect(packJugable(p(4), 'personajes', 3)).toBe(false);
    expect(filtrarPacks([p(1), p(2), p(3), p(2)], 'personajes', 2)).toHaveLength(2);
  });
  it('en solitario vale cualquier pack', () => {
    expect(filtrarPacks([p(1), p(2), p(5)], 'solitario', 1)).toHaveLength(3);
  });
});

describe('reparto', () => {
  it('da un personaje distinto a cada jugador', () => {
    const a = repartir(['a', 'b', 'c'], ['j1', 'j2', 'j3']);
    expect(new Set(Object.values(a)).size).toBe(3);
    expect(Object.keys(a).sort()).toEqual(['a', 'b', 'c']);
  });
  it('respeta las preferencias sin choques', () => {
    const a = repartir(['a', 'b', 'c'], ['j1', 'j2', 'j3'], { j1: 'c', j2: 'c', j3: 'a' });
    expect(a.c).toBe('j1');
    expect(a.a).toBe('j3');
    expect(a.b).toBe('j2');
  });
  it('falla si no cuadra el número', () => {
    expect(() => repartir(['a'], ['j1', 'j2'])).toThrow();
  });
  it('rotar pasa cada personaje al siguiente jugador', () => {
    expect(rotar({ a: 'j1', b: 'j2', c: 'j3' }, ['a', 'b', 'c'])).toEqual({ a: 'j3', b: 'j1', c: 'j2' });
  });
});

describe('líneas de cada jugador', () => {
  const pack = { lineas: [
    { id: 'l1', personaje: 'a', inicio: 0, fin: 1, texto: '' },
    { id: 'l2', personaje: 'b', inicio: 1, fin: 2, texto: '' },
    { id: 'l3', personaje: 'a', inicio: 2, fin: 3, texto: '' },
  ] };
  it('modo personajes: solo las de su personaje', () => {
    expect(lineasDeJugador(pack, 'personajes', { a: 'j1', b: 'j2' }, 'j1').map((l) => l.id)).toEqual(['l1', 'l3']);
  });
  it('solitario: todas', () => {
    expect(lineasDeJugador(pack, 'solitario', {}, 'j1')).toHaveLength(3);
  });
});

describe('validarPack', () => {
  const base: Pack = {
    version: 1, id: 'mi-pack', titulo: 'T', obra: 'O', tipo: 'pelicula', autor: 'a', idiomaOriginal: 'es', duracion: 10,
    estado: 'listo', personajes: [{ id: 'a', nombre: 'A', color: '#fff' }],
    lineas: [{ id: 'l1', personaje: 'a', inicio: 1, fin: 2, texto: 'hola' }],
  };
  it('acepta un pack correcto', () => expect(validarPack(base)).toBeNull());
  it('rechaza ids peligrosos', () => expect(validarPack({ ...base, id: '../x' })).not.toBeNull());
  it('rechaza personajes inexistentes', () =>
    expect(validarPack({ ...base, lineas: [{ ...base.lineas[0], personaje: 'z' }] })).not.toBeNull());
  it('rechaza tiempos al revés', () =>
    expect(validarPack({ ...base, lineas: [{ ...base.lineas[0], inicio: 3, fin: 2 }] })).not.toBeNull());
});

describe('dividir el texto de una línea', () => {
  it('corta por el final de frase más cercano', () => {
    expect(dividirTexto('Ponme un ejemplo. ¿Un ejemplo?', 0.5)).toEqual(['Ponme un ejemplo.', '¿Un ejemplo?']);
    expect(dividirTexto('Sí. Vale, te lo explico con calma y despacio.', 0.5)).toEqual(['Sí.', 'Vale, te lo explico con calma y despacio.']);
  });
  it('sin finales de frase, por la palabra más cercana', () => {
    expect(dividirTexto('uno dos tres cuatro', 0.5)).toEqual(['uno dos', 'tres cuatro']);
    expect(dividirTexto('hola', 0.5)).toEqual(['hola', '']);
  });
});
