// Guía visual al doblar: la voz original de tu línea y la tuya superpuestas
// (en directo mientras grabas), con el cabezal que avanza y la entonación de
// ambas en la franja inferior para comparar.
//
// Colores aptos para daltonismo (paleta Okabe-Ito): azul cielo para el original
// y naranja para ti. Además tu voz lleva contorno, así se distinguen también
// por la forma cuando se solapan.
import { useEffect, useMemo, useRef } from 'react';
import { tono, type PuntoTono } from '../audio/tono';

export interface MuestraDirecto {
  t: number; // tiempo de clip
  v: number; // nivel (pico) del micro
}

interface Props {
  /** Voz original (mono) del tramo [desde, hasta]. */
  original: Float32Array | null;
  sr: number;
  desde: number;
  hasta: number;
  linea: { inicio: number; fin: number };
  pos: number | null;
  /** Toma ya colocada (tiempo de clip en que empieza). */
  toma?: { datos: Float32Array; sr: number; en: number } | null;
  /** Niveles del micro mientras se graba. */
  directo?: MuestraDirecto[];
}

export const COLOR_ORIGINAL = '#56b4e9';
export const COLOR_TUYO = '#e69f00';
const RELLENO_ORIGINAL = 'rgba(86, 180, 233, 0.55)';
const RELLENO_TUYO = 'rgba(230, 159, 0, 0.28)';
const COLOR_CABEZAL = '#f4efe2';

function picos(x: Float32Array, columnas: number): Float32Array {
  const out = new Float32Array(columnas);
  const porCol = x.length / columnas;
  for (let c = 0; c < columnas; c++) {
    let m = 0;
    const a = Math.floor(c * porCol);
    const b = Math.min(x.length, Math.floor((c + 1) * porCol));
    for (let i = a; i < b; i += 2) m = Math.max(m, Math.abs(x[i]));
    out[c] = m;
  }
  return out;
}

/** Silueta simétrica alrededor de `medio` a partir de alturas por columna. */
function silueta(g: CanvasRenderingContext2D, x0: number, alturas: ArrayLike<number>, medio: number) {
  g.beginPath();
  g.moveTo(x0, medio);
  for (let i = 0; i < alturas.length; i++) g.lineTo(x0 + i, medio - alturas[i]);
  for (let i = alturas.length - 1; i >= 0; i--) g.lineTo(x0 + i, medio + alturas[i]);
  g.closePath();
}

export function GuiaOnda({ original, sr, desde, hasta, linea, pos, toma, directo }: Props) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  // Solo cuenta la voz de tu línea: lo de antes y después es de otros personajes
  const originalLinea = useMemo(() => {
    if (!original) return null;
    const a = Math.max(0, Math.floor((linea.inicio - desde) * sr));
    const b = Math.min(original.length, Math.ceil((linea.fin - desde) * sr));
    return b > a ? original.subarray(a, b) : null;
  }, [original, sr, desde, linea.inicio, linea.fin]);
  const tonoOriginal = useMemo<PuntoTono[]>(() => (originalLinea ? tono(originalLinea, sr) : []), [originalLinea, sr]);
  const tonoToma = useMemo<PuntoTono[]>(() => (toma ? tono(toma.datos, toma.sr) : []), [toma]);

  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    const dur = Math.max(0.01, hasta - desde);
    const x = (t: number) => ((t - desde) / dur) * w;
    const zonaOnda = h * 0.68;
    const medio = zonaOnda / 2;
    const alto = medio * 0.9;

    // Límites de la línea y separación de la franja de entonación
    g.fillStyle = 'rgba(236, 230, 214, 0.28)';
    for (const t of [linea.inicio, linea.fin]) g.fillRect(x(t), 0, Math.max(1, dpr), h);
    g.fillStyle = 'rgba(236, 230, 214, 0.14)';
    g.fillRect(0, zonaOnda, w, Math.max(1, dpr));

    // Voz original de tu línea (relleno azul)
    if (originalLinea) {
      const x0 = Math.floor(x(linea.inicio));
      const p = picos(originalLinea, Math.max(1, Math.floor(x(linea.fin)) - x0));
      let max = 0;
      for (const v of p) max = Math.max(max, v);
      const escala = max > 0 ? alto / max : 0;
      g.fillStyle = RELLENO_ORIGINAL;
      silueta(g, x0, p.map((v) => v * escala), medio);
      g.fill();
    }

    // Tu voz encima (contorno naranja): la toma colocada o, mientras grabas, los niveles en directo
    let tuya: { x0: number; alturas: Float32Array } | null = null;
    if (toma) {
      const x0 = Math.floor(x(toma.en));
      const p = picos(toma.datos, Math.max(1, Math.floor(x(toma.en + toma.datos.length / toma.sr)) - x0));
      let max = 0;
      for (const v of p) max = Math.max(max, v);
      const escala = max > 0 ? alto / max : 0;
      tuya = { x0, alturas: p.map((v) => v * escala) };
    } else if (directo && directo.length > 1) {
      const x0 = Math.floor(x(directo[0].t));
      const alturas = new Float32Array(Math.max(1, Math.ceil(x(directo[directo.length - 1].t)) - x0));
      for (let k = 1; k < directo.length; k++) {
        const v = Math.min(1, directo[k].v * 2.2) * alto;
        for (let i = Math.floor(x(directo[k - 1].t)) - x0; i < Math.ceil(x(directo[k].t)) - x0; i++) {
          if (i >= 0 && i < alturas.length) alturas[i] = v;
        }
      }
      tuya = { x0, alturas };
    }
    if (tuya) {
      g.fillStyle = RELLENO_TUYO;
      silueta(g, tuya.x0, tuya.alturas, medio);
      g.fill();
      g.strokeStyle = COLOR_TUYO;
      g.lineWidth = 1.5 * dpr;
      g.lineJoin = 'round';
      g.stroke();
    }

    // Entonación de las dos voces en la misma escala (logarítmica, 70-400 Hz)
    const yTono = (hz: number) => {
      const r = (Math.log(hz) - Math.log(70)) / (Math.log(400) - Math.log(70));
      return h - 4 * dpr - Math.max(0, Math.min(1, r)) * (h - zonaOnda - 8 * dpr);
    };
    g.fillStyle = COLOR_ORIGINAL;
    for (const p of tonoOriginal) g.fillRect(x(linea.inicio + p.t) - dpr, yTono(p.hz) - dpr, 2.5 * dpr, 2.5 * dpr);
    if (toma) {
      // Los tuyos, algo más grandes y con borde oscuro para que destaquen encima
      g.fillStyle = COLOR_TUYO;
      g.strokeStyle = '#050507';
      g.lineWidth = dpr;
      for (const p of tonoToma) {
        g.beginPath();
        g.arc(x(toma.en + p.t), yTono(p.hz), 2.2 * dpr, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }

    // Línea central y leyenda
    g.fillStyle = 'rgba(236, 230, 214, 0.3)';
    g.fillRect(0, medio, w, Math.max(1, dpr));
    g.font = `600 ${10 * dpr}px Cinzel, serif`;
    g.textBaseline = 'top';
    g.fillStyle = COLOR_ORIGINAL;
    g.fillText('■ ORIGINAL', 6 * dpr, 5 * dpr);
    g.fillStyle = COLOR_TUYO;
    g.fillText('□ TÚ', 6 * dpr + g.measureText('■ ORIGINAL   ').width, 5 * dpr);

    // Cabezal
    if (pos !== null && pos >= desde && pos <= hasta) {
      g.fillStyle = COLOR_CABEZAL;
      g.fillRect(x(pos) - dpr, 0, 2 * dpr, h);
    }
  }, [originalLinea, sr, desde, hasta, linea.inicio, linea.fin, pos, toma, directo, tonoOriginal, tonoToma]);

  return <canvas ref={lienzo} className="guia-onda" data-testid="guia-onda" />;
}
