// Lógica de las salas: estado y transiciones (sin sockets, para poder testearla).
import crypto from 'node:crypto';
import type { ConfigSala, EstadoSala, Jugador, Pack, ProgresoJugador } from '../shared/tipos';
import { configValida, lineasDeJugador, repartir, rotar } from '../shared/reglas';

export const MAX_JUGADORES = 8;
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export type CargarPack = (id: string) => Pack | null;

export class ErrorSala extends Error {}

function nuevoId(): string {
  return crypto.randomBytes(6).toString('hex');
}

export class Sala {
  readonly codigo: string;
  anfitrion: string;
  fase: EstadoSala['fase'] = 'lobby';
  ronda = 0;
  config: ConfigSala = { modo: 'personajes', escucharOriginal: true, reparto: 'aleatorio', packId: null };
  jugadores: Jugador[] = [];
  tokens = new Map<string, string>();
  asignacion: Record<string, string> = {};
  preferencias: Record<string, string> = {};
  tomas: Record<string, Set<string>> = {};
  /** jugadorId -> lineas que le tocan en esta ronda */
  encargos: Record<string, string[]> = {};
  terminados = new Set<string>();
  montajeListo = new Set<string>();
  votos: Record<string, string> = {};
  recuento: Record<string, number> = {};
  ultimaActividad = Date.now();
  /** Participantes de la ronda en curso (en orden). */
  participantes: string[] = [];

  constructor(codigo: string, private cargarPack: CargarPack) {
    this.codigo = codigo;
    this.anfitrion = '';
  }

  // ---------- Jugadores ----------
  unir(nombre: string): { jugadorId: string; token: string } {
    nombre = nombre.trim().slice(0, 24);
    if (!nombre) throw new ErrorSala('Escribe un nombre');
    if (this.jugadores.length >= MAX_JUGADORES) throw new ErrorSala('La sala está llena');
    if (this.fase !== 'lobby') throw new ErrorSala('La partida ya ha empezado; espera a la siguiente ronda');
    if (this.jugadores.some((j) => j.nombre.toLowerCase() === nombre.toLowerCase())) {
      throw new ErrorSala('Ya hay alguien con ese nombre');
    }
    const id = nuevoId();
    const token = crypto.randomBytes(16).toString('hex');
    this.jugadores.push({ id, nombre, conectado: true, puntos: 0 });
    this.tokens.set(id, token);
    if (!this.anfitrion) this.anfitrion = id;
    this.tocar();
    return { jugadorId: id, token };
  }

  reconectar(jugadorId: string, token: string): boolean {
    const j = this.jugador(jugadorId);
    if (!j || this.tokens.get(jugadorId) !== token) return false;
    j.conectado = true;
    this.tocar();
    return true;
  }

  autenticar(jugadorId: string, token: string | undefined): boolean {
    return !!token && this.tokens.get(jugadorId) === token;
  }

  desconectar(jugadorId: string): void {
    const j = this.jugador(jugadorId);
    if (!j) return;
    j.conectado = false;
    if (this.anfitrion === jugadorId) {
      const otro = this.jugadores.find((x) => x.conectado);
      if (otro) this.anfitrion = otro.id;
    }
    this.tocar();
  }

  expulsar(quien: string, objetivo: string): void {
    this.soloAnfitrion(quien);
    if (objetivo === quien) throw new ErrorSala('No puedes expulsarte a ti mismo');
    this.quitar(objetivo);
  }

  quitar(jugadorId: string): void {
    this.jugadores = this.jugadores.filter((j) => j.id !== jugadorId);
    this.tokens.delete(jugadorId);
    delete this.preferencias[jugadorId];
    for (const [p, j] of Object.entries(this.asignacion)) if (j === jugadorId) delete this.asignacion[p];
    if (this.anfitrion === jugadorId) this.anfitrion = this.jugadores.find((j) => j.conectado)?.id ?? this.jugadores[0]?.id ?? '';
    this.comprobarFinGrabacion();
    this.tocar();
  }

  jugador(id: string): Jugador | undefined {
    return this.jugadores.find((j) => j.id === id);
  }

  get vacia(): boolean {
    return this.jugadores.every((j) => !j.conectado);
  }

  // ---------- Configuración ----------
  configurar(quien: string, cambios: Partial<ConfigSala>): void {
    this.soloAnfitrion(quien);
    this.soloEnLobby();
    const c = { ...this.config };
    if (cambios.modo === 'personajes' || cambios.modo === 'solitario') c.modo = cambios.modo;
    if (typeof cambios.escucharOriginal === 'boolean') c.escucharOriginal = cambios.escucharOriginal;
    if (cambios.reparto === 'aleatorio' || cambios.reparto === 'elegir') c.reparto = cambios.reparto;
    if (cambios.packId !== undefined) {
      if (cambios.packId !== null && !this.cargarPack(cambios.packId)) throw new ErrorSala('Ese pack no existe');
      if (cambios.packId !== c.packId) {
        this.preferencias = {};
        this.asignacion = {};
      }
      c.packId = cambios.packId;
    }
    this.config = c;
    this.tocar();
  }

  elegirPersonaje(quien: string, personajeId: string | null): void {
    this.soloEnLobby();
    const pack = this.pack();
    if (personajeId === null) {
      delete this.preferencias[quien];
    } else {
      if (!pack?.personajes.some((p) => p.id === personajeId)) throw new ErrorSala('Ese personaje no existe');
      const ocupado = Object.entries(this.preferencias).find(([j, p]) => p === personajeId && j !== quien);
      if (ocupado) throw new ErrorSala('Ese personaje ya lo ha elegido otra persona');
      this.preferencias[quien] = personajeId;
    }
    this.tocar();
  }

  pack(): Pack | null {
    return this.config.packId ? this.cargarPack(this.config.packId) : null;
  }

  // ---------- Partida ----------
  empezar(quien: string, azar: () => number = Math.random): void {
    this.soloAnfitrion(quien);
    this.soloEnLobby();
    const conectados = this.jugadores.filter((j) => j.conectado);
    const pack = this.pack();
    const error = configValida(this.config, pack, conectados.length);
    if (error || !pack) throw new ErrorSala(error ?? 'Elige un pack');
    this.participantes = conectados.map((j) => j.id);
    if (this.config.modo === 'personajes') {
      const personajes = pack.personajes.map((p) => p.id);
      const anterior = this.asignacion;
      const repetirReparto =
        this.ronda > 0 &&
        personajes.every((p) => anterior[p] && this.participantes.includes(anterior[p])) &&
        Object.keys(anterior).length === personajes.length;
      this.asignacion = repetirReparto && this.config.reparto === 'aleatorio'
        ? rotar(anterior, personajes)
        : repartir(personajes, this.participantes, this.config.reparto === 'elegir' ? this.preferencias : {}, azar);
    } else {
      this.asignacion = {};
    }
    this.ronda += 1;
    this.tomas = {};
    this.encargos = {};
    for (const j of this.participantes) {
      this.encargos[j] = lineasDeJugador(pack, this.config.modo, this.asignacion, j).map((l) => l.id);
      this.tomas[j] = new Set();
    }
    this.terminados.clear();
    this.montajeListo.clear();
    this.votos = {};
    this.recuento = {};
    this.fase = 'grabando';
    this.tocar();
  }

  /** Registra una toma subida. Devuelve false si la línea no le corresponde. */
  registrarToma(jugadorId: string, ronda: number, lineaId: string): boolean {
    if (this.fase !== 'grabando' || ronda !== this.ronda) return false;
    if (!this.encargos[jugadorId]?.includes(lineaId)) return false;
    this.tomas[jugadorId].add(lineaId);
    this.tocar();
    return true;
  }

  terminarGrabacion(jugadorId: string): void {
    if (this.fase !== 'grabando' || !this.encargos[jugadorId]) return;
    this.terminados.add(jugadorId);
    this.comprobarFinGrabacion();
    this.tocar();
  }

  /** El anfitrión puede pasar al montaje aunque falte alguien. */
  forzarMontaje(quien: string): void {
    this.soloAnfitrion(quien);
    if (this.fase !== 'grabando') return;
    this.fase = 'montaje';
    this.tocar();
  }

  private comprobarFinGrabacion(): void {
    if (this.fase !== 'grabando') return;
    const pendientes = this.participantes.filter(
      (j) => this.jugador(j)?.conectado && !this.terminados.has(j),
    );
    if (pendientes.length === 0) this.fase = 'montaje';
  }

  marcarMontajeListo(jugadorId: string): void {
    if (this.fase === 'montaje' || this.fase === 'votacion' || this.fase === 'resultados') {
      this.montajeListo.add(jugadorId);
      this.tocar();
    }
  }

  empezarVotacion(quien: string): void {
    this.soloAnfitrion(quien);
    if (this.fase !== 'montaje') throw new ErrorSala('Ahora no se puede votar');
    if (this.config.modo !== 'solitario' || this.participantes.length < 2) {
      throw new ErrorSala('La votación es para el modo en solitario con 2 o más jugadores');
    }
    this.fase = 'votacion';
    this.votos = {};
    this.tocar();
  }

  votar(quien: string, por: string): void {
    if (this.fase !== 'votacion') throw new ErrorSala('No hay ninguna votación abierta');
    if (quien === por) throw new ErrorSala('No puedes votarte a ti mismo');
    if (!this.participantes.includes(por)) throw new ErrorSala('Ese jugador no ha participado');
    if (!this.participantes.includes(quien)) throw new ErrorSala('No participas en esta ronda');
    this.votos[quien] = por;
    const votantes = this.participantes.filter((j) => this.jugador(j)?.conectado);
    if (votantes.every((j) => this.votos[j])) this.cerrarVotacion();
    this.tocar();
  }

  cerrarVotacion(): void {
    const recuento: Record<string, number> = {};
    for (const por of Object.values(this.votos)) recuento[por] = (recuento[por] ?? 0) + 1;
    for (const [id, n] of Object.entries(recuento)) {
      const j = this.jugador(id);
      if (j) j.puntos += n;
    }
    this.recuento = recuento;
    this.fase = 'resultados';
  }

  nuevaRonda(quien: string): void {
    this.soloAnfitrion(quien);
    this.fase = 'lobby';
    this.montajeListo.clear();
    this.terminados.clear();
    this.tocar();
  }

  // ---------- Utilidades ----------
  estado(): EstadoSala {
    const progreso: Record<string, ProgresoJugador> = {};
    for (const j of this.participantes) {
      progreso[j] = {
        grabadas: this.tomas[j]?.size ?? 0,
        total: this.encargos[j]?.length ?? 0,
        terminado: this.terminados.has(j),
      };
    }
    return {
      codigo: this.codigo,
      anfitrion: this.anfitrion,
      fase: this.fase,
      ronda: this.ronda,
      config: this.config,
      jugadores: this.jugadores,
      asignacion: this.asignacion,
      preferencias: this.preferencias,
      progreso,
      tomas: Object.fromEntries(Object.entries(this.tomas).map(([j, s]) => [j, [...s]])),
      montajeListo: [...this.montajeListo],
      votos: this.votos,
      recuento: this.recuento,
    };
  }

  private soloAnfitrion(quien: string): void {
    if (quien !== this.anfitrion) throw new ErrorSala('Solo el anfitrión puede hacer eso');
  }

  private soloEnLobby(): void {
    if (this.fase !== 'lobby') throw new ErrorSala('Solo se puede cambiar en la sala de espera');
  }

  private tocar(): void {
    this.ultimaActividad = Date.now();
  }
}

export class GestorSalas {
  salas = new Map<string, Sala>();

  constructor(private cargarPack: CargarPack, private azar: () => number = Math.random) {}

  crear(): Sala {
    let codigo = '';
    do {
      codigo = Array.from({ length: 4 }, () => LETRAS[Math.floor(this.azar() * LETRAS.length)]).join('');
    } while (this.salas.has(codigo));
    const sala = new Sala(codigo, this.cargarPack);
    this.salas.set(codigo, sala);
    return sala;
  }

  obtener(codigo: string): Sala | undefined {
    return this.salas.get(codigo.trim().toUpperCase());
  }

  /** Borra salas abandonadas. Devuelve los códigos borrados. */
  limpiar(maxInactividadMs: number): string[] {
    const ahora = Date.now();
    const borradas: string[] = [];
    for (const [codigo, sala] of this.salas) {
      if (sala.vacia && ahora - sala.ultimaActividad > maxInactividadMs) {
        this.salas.delete(codigo);
        borradas.push(codigo);
      }
    }
    return borradas;
  }
}
