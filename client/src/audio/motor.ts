// Motor de audio del navegador: carga de packs, reproducción sincronizada con
// el vídeo y grabación del micrófono con marcas de tiempo precisas.

let ctxGlobal: AudioContext | null = null;

export function contexto(): AudioContext {
  if (!ctxGlobal) ctxGlobal = new AudioContext({ latencyHint: 'interactive' });
  return ctxGlobal;
}

export async function despertar(): Promise<AudioContext> {
  const ctx = contexto();
  if (ctx.state !== 'running') await ctx.resume();
  return ctx;
}

// ---------------------------------------------------------------------------
// Ajustes del jugador (en este navegador)

function leerAjuste(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}
function guardarAjuste(clave: string, valor: string) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento */
  }
}

/** Retraso extra medido con la calibración (s); p. ej. auriculares Bluetooth. */
export function latenciaExtra(): number {
  const v = Number(leerAjuste('dubgame.latenciaExtra'));
  return Number.isFinite(v) ? Math.max(0, Math.min(0.6, v)) : 0;
}
export function guardarLatenciaExtra(s: number) {
  guardarAjuste('dubgame.latenciaExtra', String(Math.max(0, Math.min(0.6, s))));
}

export type ModoMicro = 'auriculares' | 'altavoces';
export function modoMicro(): ModoMicro {
  return leerAjuste('dubgame.micro') === 'altavoces' ? 'altavoces' : 'auriculares';
}
export function guardarModoMicro(m: ModoMicro) {
  guardarAjuste('dubgame.micro', m);
}

/** Latencia de salida (s): la que informa el navegador + la calibrada. */
export function latenciaSalida(ctx: AudioContext): number {
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + latenciaExtra();
}

const cacheBuffers = new Map<string, Promise<AudioBuffer>>();

export function cargarBuffer(url: string): Promise<AudioBuffer> {
  let p = cacheBuffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`No se pudo descargar ${url}`);
        return r.arrayBuffer();
      })
      .then((b) => contexto().decodeAudioData(b));
    p.catch(() => cacheBuffers.delete(url));
    cacheBuffers.set(url, p);
  }
  return p;
}

export interface AudioPack {
  fondo: AudioBuffer;
  voces: AudioBuffer;
}

export async function cargarAudioPack(packId: string): Promise<AudioPack> {
  const [fondo, voces] = await Promise.all([
    cargarBuffer(`/packs/${packId}/fondo.mp3`),
    cargarBuffer(`/packs/${packId}/voces.mp3`),
  ]);
  return { fondo, voces };
}

export function canalesDe(b: AudioBuffer): Float32Array[] {
  return Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
}

export function crearBuffer(canales: Float32Array[], sr: number): AudioBuffer {
  const b = contexto().createBuffer(canales.length, canales[0].length, sr);
  canales.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return b;
}

// ---------------------------------------------------------------------------
// Reproducción de un tramo del clip con vídeo sincronizado

export interface Pista {
  buffer: AudioBuffer;
  /** Momento del clip (s) en el que empieza el buffer. */
  en: number;
  ganancia?: number;
  /** Automatización de ganancia en tiempo de clip: [t, valor][] */
  automatizacion?: [number, number][];
}

export interface Tramo {
  desde: number;
  hasta: number;
  pistas: Pista[];
  video?: HTMLVideoElement | null;
  /** Hora del AudioContext a la que debe empezar (por defecto, ya + 0.1 s). */
  cuando?: number;
  /** O bien: segundos de espera desde que el vídeo está listo (p. ej. una cuenta atrás). */
  retraso?: number;
}

export class Reproduccion {
  readonly t0: number; // hora del contexto que corresponde a `desde`
  private nodos: AudioScheduledSourceNode[] = [];
  private raf = 0;
  private parado = false;
  readonly terminada: Promise<void>;
  private resolver!: () => void;

  constructor(private ctx: AudioContext, private tramo: Tramo) {
    this.t0 = tramo.cuando ?? ctx.currentTime + 0.12;
    this.terminada = new Promise((r) => (this.resolver = r));
    const { desde, hasta } = tramo;
    for (const p of tramo.pistas) {
      const fin = p.en + p.buffer.duration;
      if (fin <= desde || p.en >= hasta) continue;
      const src = ctx.createBufferSource();
      src.buffer = p.buffer;
      const g = ctx.createGain();
      g.gain.value = p.ganancia ?? 1;
      for (const [t, v] of p.automatizacion ?? []) {
        g.gain.setValueAtTime(v, Math.max(this.t0, this.t0 + (t - desde)));
      }
      src.connect(g).connect(ctx.destination);
      const offset = Math.max(0, desde - p.en);
      const cuando = this.t0 + Math.max(0, p.en - desde);
      src.start(cuando, offset, Math.max(0, Math.min(fin, hasta) - Math.max(p.en, desde)));
      this.nodos.push(src);
    }
    const duracion = hasta - desde;
    const fin = ctx.createConstantSource();
    fin.connect(ctx.destination);
    fin.offset.value = 0;
    fin.onended = () => this.acabar();
    fin.start(this.t0);
    fin.stop(this.t0 + duracion);
    this.nodos.push(fin);
    this.sincronizarVideo();
  }

  /** Posición actual en tiempo de clip. */
  posicion(): number {
    return this.tramo.desde + (this.ctx.currentTime - this.t0) - latenciaSalida(this.ctx);
  }

  private sincronizarVideo() {
    const v = this.tramo.video;
    if (!v) return;
    v.muted = true;
    v.playbackRate = 1;
    const paso = () => {
      if (this.parado) return;
      const objetivo = this.posicion();
      if (objetivo >= this.tramo.desde - 0.02 && !v.seeking) {
        if (v.paused) v.play().catch(() => {});
        const deriva = v.currentTime - objetivo;
        if (Math.abs(deriva) > 0.3) {
          // Salto solo si se ha ido mucho (y nunca mientras ya está saltando)
          v.currentTime = objetivo + 0.05;
          v.playbackRate = 1;
        } else {
          // Corrección suave: acelera o frena un poco hasta cuadrar
          v.playbackRate = Math.abs(deriva) < 0.02 ? 1 : Math.max(0.9, Math.min(1.1, 1 - deriva * 1.5));
        }
      }
      this.raf = requestAnimationFrame(paso);
    };
    this.raf = requestAnimationFrame(paso);
  }

  private acabar() {
    if (this.parado) return;
    this.parado = true;
    cancelAnimationFrame(this.raf);
    this.tramo.video?.pause();
    this.resolver();
  }

  parar() {
    for (const n of this.nodos) {
      try {
        n.onended = null;
        n.stop();
      } catch {
        /* ya parado */
      }
    }
    this.acabar();
  }
}

/** Coloca el vídeo en `t` y espera a que esté listo (como mucho 800 ms). */
async function prepararVideo(v: HTMLVideoElement, t: number): Promise<void> {
  v.pause();
  v.playbackRate = 1;
  if (Math.abs(v.currentTime - t) < 0.03 && !v.seeking) return;
  await new Promise<void>((resolver) => {
    const listo = () => {
      clearTimeout(limite);
      v.removeEventListener('seeked', listo);
      resolver();
    };
    const limite = setTimeout(listo, 800);
    v.addEventListener('seeked', listo);
    try {
      v.currentTime = t;
    } catch {
      listo();
    }
  });
}

/**
 * Reproduce un tramo del clip. Primero deja el vídeo en su sitio y después
 * programa el audio, para que imagen, sonido y subtítulos arranquen juntos.
 */
export async function reproducir(tramo: Tramo): Promise<Reproduccion> {
  const ctx = contexto();
  if (tramo.video) await prepararVideo(tramo.video, tramo.desde);
  const cuando = tramo.cuando !== undefined
    ? Math.max(tramo.cuando, ctx.currentTime + 0.05)
    : tramo.retraso !== undefined ? ctx.currentTime + Math.max(0.05, tramo.retraso) : undefined;
  return new Reproduccion(ctx, { ...tramo, cuando });
}

// ---------------------------------------------------------------------------
// Micrófono

export class Microfono {
  private bloques: { frame: number; datos: Float32Array }[] = [];
  private nodo: AudioWorkletNode | null = null;
  private fuente: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  nivel = 0;

  static async abrir(modo: ModoMicro = modoMicro()): Promise<Microfono> {
    const ctx = await despertar();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no permite usar el micrófono aquí. Usa HTTPS o localhost.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      // Con auriculares, sin procesado del navegador: la supresión de ruido y la
      // cancelación de eco deforman la voz. Con altavoces hace falta la cancelación
      // de eco para que el micro no grabe el vídeo.
      audio: modo === 'auriculares'
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
        : { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    await ctx.audioWorklet.addModule('/grabador-worklet.js');
    const m = new Microfono();
    m.stream = stream;
    m.fuente = ctx.createMediaStreamSource(stream);
    m.nodo = new AudioWorkletNode(ctx, 'grabador', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    m.nodo.port.onmessage = (e: MessageEvent<{ frame: number; datos: Float32Array }>) => {
      m.bloques.push(e.data);
      let pico = 0;
      for (let i = 0; i < e.data.datos.length; i += 8) pico = Math.max(pico, Math.abs(e.data.datos[i]));
      m.nivel = pico;
      // Se guardan como mucho ~60 s
      const max = Math.ceil((ctx.sampleRate * 60) / 2048);
      if (m.bloques.length > max) m.bloques.splice(0, m.bloques.length - max);
    };
    const silencio = ctx.createGain();
    silencio.gain.value = 0;
    m.fuente.connect(m.nodo).connect(silencio).connect(ctx.destination);
    return m;
  }

  /** Extrae el audio entre dos horas del AudioContext. */
  extraer(desde: number, hasta: number): Float32Array {
    const sr = contexto().sampleRate;
    const f0 = Math.round(desde * sr);
    const f1 = Math.round(hasta * sr);
    const out = new Float32Array(Math.max(0, f1 - f0));
    for (const b of this.bloques) {
      const ini = b.frame;
      const fin = ini + b.datos.length;
      if (fin <= f0 || ini >= f1) continue;
      const a = Math.max(ini, f0);
      const z = Math.min(fin, f1);
      out.set(b.datos.subarray(a - ini, z - ini), a - f0);
    }
    return out;
  }

  cerrar() {
    this.nodo?.disconnect();
    this.fuente?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.bloques = [];
  }
}

export function esperar(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
