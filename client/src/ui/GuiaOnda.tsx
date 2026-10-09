// Guía visual al doblar: forma de onda de la voz original, cabezal que avanza,
// tu voz encima (en directo mientras grabas) y puntos de entonación.
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
  color: string;
}

const COLOR_ORIGINAL = 'rgba(178, 92, 214, 0.75)';
const COLOR_TOMA = 'rgba(255, 112, 214, 0.9)';
const COLOR_TONO_ORIG = '#9fd38c';
const COLOR_TONO_TOMA = '#ff7a7a';
const COLOR_CABEZAL = '#e0763a';

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

export function GuiaOnda({ original, sr, desde, hasta, linea, pos, toma, directo, color }: Props) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const tonoOriginal = useMemo<PuntoTono[]>(() => (original ? tono(original, sr) : []), [original, sr]);
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

    // Tu línea, resaltada
    g.fillStyle = 'rgba(236, 230, 214, 0.06)';
    g.fillRect(x(linea.inicio), 0, x(linea.fin) - x(linea.inicio), h);
    g.strokeStyle = color;
    g.globalAlpha = 0.5;
    g.lineWidth = 1 * dpr;
    for (const t of [linea.inicio, linea.fin]) {
      g.beginPath();
      g.moveTo(x(t), 0);
      g.lineTo(x(t), h);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Onda original (simétrica)
    if (original) {
      const p = picos(original, w);
      let max = 0;
      for (const v of p) max = Math.max(max, v);
      const escala = max > 0 ? (medio * 0.92) / max : 0;
      g.fillStyle = COLOR_ORIGINAL;
      g.beginPath();
      g.moveTo(0, medio);
      for (let i = 0; i < w; i++) g.lineTo(i, medio - p[i] * escala);
      for (let i = w - 1; i >= 0; i--) g.lineTo(i, medio + p[i] * escala);
      g.closePath();
      g.fill();
    }

    // Tu voz: la toma colocada o, mientras grabas, los niveles en directo
    g.fillStyle = COLOR_TOMA;
    if (toma) {
      const ini = Math.max(0, Math.floor(x(toma.en)));
      const ancho = Math.max(1, Math.floor(x(toma.en + toma.datos.length / toma.sr)) - Math.floor(x(toma.en)));
      const p = picos(toma.datos, ancho);
      let max = 0;
      for (const v of p) max = Math.max(max, v);
      const escala = max > 0 ? (medio * 0.6) / max : 0;
      for (let i = 0; i < ancho; i++) {
        const xx = Math.floor(x(toma.en)) + i;
        if (xx < ini || xx >= w) continue;
        const alto = p[i] * escala;
        g.fillRect(xx, medio - alto, 1, alto * 2);
      }
    } else if (directo && directo.length > 1) {
      for (let k = 1; k < directo.length; k++) {
        const a = directo[k - 1];
        const b = directo[k];
        const alto = Math.min(1, b.v * 2.2) * medio * 0.6;
        g.fillRect(x(a.t), medio - alto, Math.max(1, x(b.t) - x(a.t)), alto * 2);
      }
    }

    // Entonación: puntos en la franja de abajo (escala logarítmica 70-400 Hz)
    const yTono = (hz: number) => {
      const r = (Math.log(hz) - Math.log(70)) / (Math.log(400) - Math.log(70));
      return h - 4 * dpr - Math.max(0, Math.min(1, r)) * (h - zonaOnda - 8 * dpr);
    };
    const puntos = (lista: PuntoTono[], t0: number, col: string) => {
      g.fillStyle = col;
      for (const p of lista) g.fillRect(x(t0 + p.t) - dpr, yTono(p.hz) - dpr, 2 * dpr, 2 * dpr);
    };
    puntos(tonoOriginal, desde, COLOR_TONO_ORIG);
    if (toma) puntos(tonoToma, toma.en, COLOR_TONO_TOMA);

    // Línea central y cabezal
    g.fillStyle = 'rgba(236, 230, 214, 0.35)';
    g.fillRect(0, medio, w, Math.max(1, dpr));
    if (pos !== null && pos >= desde && pos <= hasta) {
      g.fillStyle = COLOR_CABEZAL;
      g.fillRect(x(pos) - dpr, 0, 2 * dpr, h);
    }
  }, [original, sr, desde, hasta, linea.inicio, linea.fin, pos, toma, directo, color, tonoOriginal, tonoToma]);

  return <canvas ref={lienzo} className="guia-onda" data-testid="guia-onda" />;
}
