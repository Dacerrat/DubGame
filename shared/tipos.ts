// Tipos compartidos entre servidor y cliente.

export type TipoPack = 'pelicula' | 'videojuego' | 'disney' | 'serie' | 'prueba';

export interface Personaje {
  id: string;
  nombre: string;
  color: string;
}

export interface Linea {
  id: string;
  personaje: string;
  inicio: number;
  fin: number;
  texto: string;
  textoOriginal?: string;
  confianza?: number;
}

/** Voces detectadas que no forman parte del guion (se reproducen tal cual). */
export interface Extra {
  inicio: number;
  fin: number;
  texto?: string;
}

export interface Pack {
  version: number;
  id: string;
  titulo: string;
  obra: string;
  tipo: TipoPack;
  autor: string;
  idiomaOriginal: string;
  duracion: number;
  estado: 'listo' | 'revisar';
  creado?: string;
  fuente?: { url?: string | null; inicio?: number; fin?: number };
  personajes: Personaje[];
  lineas: Linea[];
  extras?: Extra[];
  /** Avisos del motor al crear el pack (p. ej. vídeo que no parece la escena). */
  avisos?: string[];
}

export interface PackResumen {
  id: string;
  titulo: string;
  obra: string;
  tipo: TipoPack;
  autor: string;
  duracion: number;
  estado: 'listo' | 'revisar';
  personajes: Personaje[];
  nLineas: number;
  /** Líneas por personaje (mismo orden que `personajes`). */
  lineasPorPersonaje: number[];
  tamano: number;
  portada: boolean;
  video: boolean;
}

export type Modo = 'personajes' | 'solitario';
export type Fase = 'lobby' | 'grabando' | 'montaje' | 'votacion' | 'resultados';

export interface ConfigSala {
  modo: Modo;
  escucharOriginal: boolean;
  reparto: 'aleatorio' | 'elegir';
  packId: string | null;
}

export interface Jugador {
  id: string;
  nombre: string;
  conectado: boolean;
  puntos: number;
}

export interface ProgresoJugador {
  grabadas: number;
  total: number;
  terminado: boolean;
}

export interface EstadoSala {
  codigo: string;
  anfitrion: string;
  fase: Fase;
  ronda: number;
  config: ConfigSala;
  jugadores: Jugador[];
  /** personajeId -> jugadorId (modo personajes). En solitario cada jugador dobla todos. */
  asignacion: Record<string, string>;
  /** Preferencias de personaje cuando el reparto es "elegir". */
  preferencias: Record<string, string>;
  progreso: Record<string, ProgresoJugador>;
  /** jugadorId -> lineaId[] con toma subida (ronda actual). */
  tomas: Record<string, string[]>;
  /** jugadores con el montaje listo para reproducir */
  montajeListo: string[];
  votos: Record<string, string>;
  /** Resultado de la última votación: jugadorId -> votos recibidos */
  recuento: Record<string, number>;
}

export interface Reproduccion {
  /** Hora del servidor (ms) a la que empieza la reproducción. */
  inicioServidor: number;
  /** En modo solitario: jugador cuya versión se reproduce. */
  version: string | null;
}

export interface RespuestaSala {
  ok: boolean;
  error?: string;
  codigo?: string;
  jugadorId?: string;
  token?: string;
}

export interface Receta {
  id: string;
  titulo: string;
  obra: string;
  tipo: TipoPack;
  idiomaOriginal?: string;
  fuente: { url?: string; busqueda?: string; inicio?: string | number; fin?: string | number };
  personajes: { id: string; nombre: string }[];
  guion: { p: string; t: string }[];
  notas?: string;
}

export interface RecetaResumen {
  id: string;
  titulo: string;
  obra: string;
  tipo: TipoPack;
  personajes: string[];
  nLineas: number;
  preparada: boolean;
}

export interface TrabajoCreador {
  id: string;
  estado: 'en-curso' | 'terminado' | 'error';
  fase: string;
  mensaje: string;
  fraccion: number | null;
  packId?: string;
  error?: string;
  registro: string[];
}
