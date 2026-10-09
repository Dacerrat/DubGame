// Conexión con el servidor: socket, sesión y sincronización de reloj.
import { io, type Socket } from 'socket.io-client';
import { useSyncExternalStore } from 'react';
import type { ConfigSala, EstadoSala, Pack, PackResumen, RespuestaSala } from '../../shared/tipos';

export const socket: Socket = io({ autoConnect: true, transports: ['websocket', 'polling'] });

interface Sesion {
  codigo: string;
  jugadorId: string;
  token: string;
}

const CLAVE_SESION = 'dubgame.sesion';
const CLAVE_NOMBRE = 'dubgame.nombre';

function leerLocal(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}
function escribirLocal(clave: string, valor: string | null) {
  try {
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, valor);
  } catch {
    /* almacenamiento no disponible */
  }
}

export function nombreGuardado(): string {
  return leerLocal(CLAVE_NOMBRE) ?? '';
}
export function guardarNombre(n: string) {
  escribirLocal(CLAVE_NOMBRE, n);
}

// ---------------- Almacén reactivo sencillo ----------------
interface Estado {
  conectado: boolean;
  sesion: Sesion | null;
  sala: EstadoSala | null;
  expulsado: boolean;
}

let estado: Estado = {
  conectado: socket.connected,
  sesion: (() => {
    try {
      return JSON.parse(sessionStorage.getItem(CLAVE_SESION) ?? 'null');
    } catch {
      return null;
    }
  })(),
  sala: null,
  expulsado: false,
};
const oyentes = new Set<() => void>();

function fijar(parcial: Partial<Estado>) {
  estado = { ...estado, ...parcial };
  if ('sesion' in parcial) {
    try {
      if (parcial.sesion) sessionStorage.setItem(CLAVE_SESION, JSON.stringify(parcial.sesion));
      else sessionStorage.removeItem(CLAVE_SESION);
    } catch {
      /* sin almacenamiento */
    }
  }
  oyentes.forEach((f) => f());
}

export function useConexion(): Estado {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => estado,
  );
}

export function estadoActual(): Estado {
  return estado;
}

socket.on('connect', () => {
  fijar({ conectado: true });
  sincronizarReloj();
  const s = estado.sesion;
  if (s) {
    socket.emit('sala:unirse', { codigo: s.codigo, jugadorId: s.jugadorId, token: s.token }, (r: RespuestaSala) => {
      if (!r.ok) fijar({ sesion: null, sala: null });
    });
  }
});
socket.on('disconnect', () => fijar({ conectado: false }));
socket.on('sala:estado', (sala: EstadoSala) => fijar({ sala }));
socket.on('sala:expulsado', () => fijar({ sesion: null, sala: null, expulsado: true }));

function emitir<T = RespuestaSala>(evento: string, datos?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(10_000).emit(evento, datos ?? {}, (err: Error | null, r: T) => {
      if (err) reject(new Error('El servidor no responde'));
      else resolve(r);
    });
  });
}

async function accion(evento: string, datos?: unknown): Promise<void> {
  const r = await emitir<RespuestaSala>(evento, datos);
  if (!r.ok) throw new Error(r.error ?? 'Error desconocido');
}

export const acciones = {
  async crearSala(nombre: string) {
    guardarNombre(nombre);
    const r = await emitir<RespuestaSala>('sala:crear', { nombre });
    if (!r.ok) throw new Error(r.error);
    fijar({ sesion: { codigo: r.codigo!, jugadorId: r.jugadorId!, token: r.token! }, expulsado: false });
  },
  async unirse(codigo: string, nombre: string) {
    guardarNombre(nombre);
    const r = await emitir<RespuestaSala>('sala:unirse', { codigo: codigo.toUpperCase(), nombre });
    if (!r.ok) throw new Error(r.error);
    fijar({ sesion: { codigo: r.codigo!, jugadorId: r.jugadorId!, token: r.token! }, expulsado: false });
  },
  async salir() {
    try {
      await accion('sala:salir');
    } finally {
      fijar({ sesion: null, sala: null });
    }
  },
  configurar: (c: Partial<ConfigSala>) => accion('sala:config', c),
  elegirPersonaje: (personajeId: string | null) => accion('sala:elegirPersonaje', { personajeId }),
  expulsar: (jugadorId: string) => accion('sala:expulsar', { jugadorId }),
  empezar: () => accion('sala:empezar'),
  terminarGrabacion: () => accion('grabacion:terminar'),
  forzarMontaje: () => accion('grabacion:forzarMontaje'),
  montajeListo: () => accion('montaje:listo'),
  reproducirMontaje: (version: string | null) => accion('montaje:reproducir', { version }),
  pararMontaje: () => accion('montaje:parar'),
  empezarVotacion: () => accion('votacion:empezar'),
  votar: (por: string) => accion('votacion:votar', { por }),
  nuevaRonda: () => accion('sala:nuevaRonda'),
  olvidarExpulsion: () => fijar({ expulsado: false }),
};

// ---------------- Reloj compartido ----------------
let desfaseReloj = 0; // horaServidor - horaLocal (ms)

export async function sincronizarReloj(muestras = 6): Promise<void> {
  const medidas: { rtt: number; desfase: number }[] = [];
  for (let i = 0; i < muestras; i++) {
    const t0 = performance.now();
    const servidor = await new Promise<number>((res) => socket.emit('hora', null, res));
    const t1 = performance.now();
    medidas.push({ rtt: t1 - t0, desfase: servidor - (performance.timeOrigin + (t0 + t1) / 2) });
  }
  medidas.sort((a, b) => a.rtt - b.rtt);
  desfaseReloj = medidas[0].desfase;
}

/** Convierte una hora del servidor (ms) en hora local de performance.now(). */
export function horaServidorALocal(ms: number): number {
  return ms - desfaseReloj - performance.timeOrigin;
}

// ---------------- API HTTP ----------------
async function json<T>(r: Response): Promise<T> {
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((datos as { error?: string }).error ?? `Error ${r.status}`);
  return datos as T;
}

export const api = {
  info: () => fetch('/api/info').then((r) => json<{ local: boolean; ffmpeg: boolean; traduccion: boolean }>(r)),
  traducir: (id: string, soloVacias: boolean) =>
    fetch(`/api/packs/${id}/traducir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ soloVacias }) })
      .then((r) => json<{ traducciones: Record<string, string> }>(r)),
  packs: () => fetch('/api/packs').then((r) => json<PackResumen[]>(r)),
  pack: (id: string) => fetch(`/api/packs/${id}`).then((r) => json<Pack>(r)),
  guardarPack: (p: Pack) =>
    fetch(`/api/packs/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
      .then((r) => json<{ pack: Pack }>(r)),
  borrarPack: (id: string) => fetch(`/api/packs/${id}`, { method: 'DELETE' }).then((r) => json(r)),
  importarPack: (archivo: File) =>
    fetch('/api/packs/importar', { method: 'POST', body: archivo }).then((r) => json<{ id: string }>(r)),
  subirToma: (codigo: string, ronda: number, lineaId: string, wav: ArrayBuffer, sesion: Sesion) =>
    fetch(`/api/salas/${codigo}/tomas/${ronda}/${lineaId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/wav', 'x-jugador': sesion.jugadorId, 'x-token': sesion.token },
      body: wav,
    }).then((r) => json(r)),
  urlToma: (codigo: string, ronda: number, jugadorId: string, lineaId: string) =>
    `/api/salas/${codigo}/tomas/${ronda}/${jugadorId}/${lineaId}`,
};
