import { describe, expect, it } from 'vitest';
import { GestorSalas } from '../../server/salas';
import type { Pack } from '../../shared/tipos';

const pack = (id: string, personajes: string[]): Pack => ({
  version: 1, id, titulo: id, obra: id, tipo: 'prueba', autor: 'x', idiomaOriginal: 'es', duracion: 30, estado: 'listo',
  personajes: personajes.map((p) => ({ id: p, nombre: p, color: '#fff' })),
  lineas: personajes.flatMap((p, i) => [0, 1, 2].map((k) => ({ id: `${p}${k}`, personaje: p, inicio: i * 3 + k, fin: i * 3 + k + 0.8, texto: 'x' }))),
});
const packs: Record<string, Pack> = { dos: pack('dos', ['a', 'b']), tres: pack('tres', ['a', 'b', 'c']) };

function sala() {
  const g = new GestorSalas((id) => packs[id] ?? null);
  const s = g.crear();
  const ana = s.unir('Ana').jugadorId;
  const luis = s.unir('Luis').jugadorId;
  return { g, s, ana, luis };
}

describe('sala', () => {
  it('el primero en entrar es el anfitrión y los nombres no se repiten', () => {
    const { s, ana } = sala();
    expect(s.anfitrion).toBe(ana);
    expect(() => s.unir('ana')).toThrow(/nombre/);
  });

  it('solo el anfitrión configura y no deja empezar con un pack que no cuadra', () => {
    const { s, ana, luis } = sala();
    expect(() => s.configurar(luis, { packId: 'dos' })).toThrow(/anfitrión/);
    s.configurar(ana, { packId: 'tres' });
    expect(() => s.empezar(ana)).toThrow(/3 personajes/);
    s.configurar(ana, { packId: 'dos' });
    s.empezar(ana);
    expect(s.fase).toBe('grabando');
    expect(new Set(Object.values(s.asignacion))).toEqual(new Set([ana, luis]));
  });

  it('las tomas solo cuentan si la línea le toca y al terminar todos pasa al montaje', () => {
    const { s, ana, luis } = sala();
    s.configurar(ana, { packId: 'dos' });
    s.empezar(ana);
    const deAna = s.encargos[ana];
    const deLuis = s.encargos[luis];
    expect(deAna).toHaveLength(3);
    expect(s.registrarToma(ana, s.ronda, deLuis[0])).toBe(false);
    for (const l of deAna) expect(s.registrarToma(ana, s.ronda, l)).toBe(true);
    s.terminarGrabacion(ana);
    expect(s.fase).toBe('grabando');
    expect(s.estado().progreso[ana]).toEqual({ grabadas: 3, total: 3, terminado: true });
    s.terminarGrabacion(luis);
    expect(s.fase).toBe('montaje');
  });

  it('si alguien se desconecta grabando, no bloquea el montaje', () => {
    const { s, ana, luis } = sala();
    s.configurar(ana, { packId: 'dos' });
    s.empezar(ana);
    s.desconectar(luis);
    s.terminarGrabacion(ana);
    expect(s.fase).toBe('montaje');
  });

  it('modo solitario: todos doblan todo y se vota sin poder votarse', () => {
    const { s, ana, luis } = sala();
    s.configurar(ana, { modo: 'solitario', packId: 'tres' });
    s.empezar(ana);
    expect(s.encargos[ana]).toHaveLength(9);
    s.terminarGrabacion(ana);
    s.terminarGrabacion(luis);
    s.empezarVotacion(ana);
    expect(() => s.votar(ana, ana)).toThrow();
    s.votar(ana, luis);
    expect(s.fase).toBe('votacion');
    s.votar(luis, ana);
    expect(s.fase).toBe('resultados');
    expect(s.jugador(ana)!.puntos).toBe(1);
    expect(s.jugador(luis)!.puntos).toBe(1);
  });

  it('en la segunda ronda con reparto aleatorio se rotan los personajes', () => {
    const { s, ana } = sala();
    s.configurar(ana, { packId: 'dos' });
    s.empezar(ana);
    const primera = { ...s.asignacion };
    s.forzarMontaje(ana);
    s.nuevaRonda(ana);
    s.empezar(ana);
    expect(s.asignacion.a).toBe(primera.b);
    expect(s.asignacion.b).toBe(primera.a);
  });

  it('el anfitrión pasa a otro jugador si se desconecta', () => {
    const { s, ana, luis } = sala();
    s.desconectar(ana);
    expect(s.anfitrion).toBe(luis);
  });
});
