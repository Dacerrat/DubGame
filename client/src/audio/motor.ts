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

/** Latencia de salida estimada (s). */
export function latenciaSalida(ctx: AudioContext): number {
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
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
    v.pause();
    v.playbackRate = 1;
    try {
      v.currentTime = this.tramo.desde;
    } catch {
      /* vídeo sin cargar */
    }
    const paso = () => {
      if (this.parado) return;
      const objetivo = this.posicion();
      if (objetivo >= this.tramo.desde) {
        if (v.paused) v.play().catch(() => {});
        const deriva = v.currentTime - objetivo;
        if (Math.abs(deriva) > 0.15) {
          v.currentTime = objetivo;
          v.playbackRate = 1;
        } else {
          v.playbackRate = Math.abs(deriva) > 0.03 ? (deriva > 0 ? 0.97 : 1.03) : 1;
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

export function reproducir(tramo: Tramo): Reproduccion {
  return new Reproduccion(contexto(), tramo);
}

// ---------------------------------------------------------------------------
// Micrófono

export class Microfono {
  private bloques: { frame: number; datos: Float32Array }[] = [];
  private nodo: AudioWorkletNode | null = null;
  private fuente: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  nivel = 0;

  static async abrir(): Promise<Microfono> {
    const ctx = await despertar();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no permite usar el micrófono aquí. Usa HTTPS o localhost.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      // Sin procesado del navegador: la supresión de ruido y la cancelación de eco
      // destrozan la voz (suena metálica y entrecortada). Se recomiendan auriculares.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
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
