// Reglas de juego puras (sin E/S), usadas por servidor y cliente.
import type { ConfigSala, Linea, Modo, Pack, PackResumen } from './tipos';

/** ¿Se puede jugar este pack con este modo y número de jugadores? */
export function packJugable(p: Pick<PackResumen, 'personajes'>, modo: Modo, nJugadores: number): boolean {
  if (p.personajes.length === 0) return false;
  if (modo === 'solitario') return nJugadores >= 1;
  return p.personajes.length === nJugadores;
}

export function filtrarPacks<T extends Pick<PackResumen, 'personajes'>>(packs: T[], modo: Modo, nJugadores: number): T[] {
  return packs.filter((p) => packJugable(p, modo, nJugadores));
}

function barajar<T>(xs: T[], azar: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Reparte un personaje por jugador.
 * - Respeta las preferencias (jugadorId -> personajeId) cuando no chocan.
 * - El resto se reparte al azar.
 */
export function repartir(
  personajes: string[],
  jugadores: string[],
  preferencias: Record<string, string> = {},
  azar: () => number = Math.random,
): Record<string, string> {
  if (personajes.length !== jugadores.length) {
    throw new Error(`Hacen falta ${personajes.length} jugadores para este pack (hay ${jugadores.length})`);
  }
  const asignacion: Record<string, string> = {};
  const libresJ = new Set(jugadores);
  for (const j of jugadores) {
    const p = preferencias[j];
    if (p && personajes.includes(p) && !(p in asignacion)) {
      asignacion[p] = j;
      libresJ.delete(j);
    }
  }
  const libresP = barajar(personajes.filter((p) => !(p in asignacion)), azar);
  const restoJ = barajar([...libresJ], azar);
  libresP.forEach((p, i) => (asignacion[p] = restoJ[i]));
  return asignacion;
}

/** Rota la asignación: cada jugador pasa al siguiente personaje. */
export function rotar(asignacion: Record<string, string>, personajes: string[]): Record<string, string> {
  const jugadores = personajes.map((p) => asignacion[p]);
  const out: Record<string, string> = {};
  personajes.forEach((p, i) => (out[p] = jugadores[(i + jugadores.length - 1) % jugadores.length]));
  return out;
}

/** Líneas que tiene que doblar un jugador. */
export function lineasDeJugador(
  pack: Pick<Pack, 'lineas'>,
  modo: Modo,
  asignacion: Record<string, string>,
  jugadorId: string,
): Linea[] {
  if (modo === 'solitario') return [...pack.lineas];
  return pack.lineas.filter((l) => asignacion[l.personaje] === jugadorId);
}

export function configValida(config: ConfigSala, pack: Pick<PackResumen, 'personajes'> | null, nJugadores: number): string | null {
  if (!pack) return 'Elige un pack';
  if (!packJugable(pack, config.modo, nJugadores)) {
    return config.modo === 'personajes'
      ? `Este pack tiene ${pack.personajes.length} personajes y sois ${nJugadores}`
      : 'Este pack no se puede jugar';
  }
  return null;
}

export function formatoDuracion(seg: number): string {
  const s = Math.round(seg);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
}

export function formatoTamano(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : mb.toFixed(0)} MB`;
}

export const NOMBRES_TIPO: Record<string, string> = {
  pelicula: 'Película',
  disney: 'Disney · Pixar',
  videojuego: 'Videojuego',
  serie: 'Serie',
  prueba: 'Prueba',
};

/** Valida (y normaliza) un pack.json recibido del editor o de un import. */
export function validarPack(p: unknown): string | null {
  const x = p as Pack;
  if (!x || typeof x !== 'object') return 'Pack vacío';
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(x.id ?? '')) return 'id no válido';
  if (!x.titulo) return 'Falta el título';
  if (!Array.isArray(x.personajes) || x.personajes.length === 0) return 'Faltan personajes';
  if (!Array.isArray(x.lineas) || x.lineas.length === 0) return 'Faltan líneas';
  const ids = new Set(x.personajes.map((q) => q.id));
  for (const l of x.lineas) {
    if (!ids.has(l.personaje)) return `La línea ${l.id} usa un personaje que no existe`;
    if (!(l.fin > l.inicio) || l.inicio < 0) return `La línea ${l.id} tiene tiempos no válidos`;
  }
  return null;
}
