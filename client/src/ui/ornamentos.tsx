// Ornamentos SVG originales (volutas, rombos, filigrana) y fondo con partículas.
import { useEffect, useRef } from 'react';

/** Ornamento lateral de las opciones de menú: voluta que termina en punta. */
export function OrnamentoOpcion({ lado }: { lado: 'izq' | 'der' }) {
  return (
    <svg className={`orn ${lado}`} viewBox="0 0 46 22" aria-hidden="true">
      <path
        d="M44 11 L30 11 C25 11 22 5 16 5 C10 5 7 9 7 12 C7 15 10 17 13 16 C15.5 15.2 15.5 12 13 11.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M30 11 C25 11 22 17 16 17.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
      <path d="M46 11 L41 8 L37 11 L41 14 Z" fill="currentColor" />
    </svg>
  );
}

/** Separador horizontal con rombo central y volutas. */
export function Separador({ ancho = 360 }: { ancho?: number }) {
  return (
    <svg className="separador" width={ancho} height="24" viewBox="0 0 360 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M10 12 H150" strokeWidth="1" opacity="0.6" />
        <path d="M210 12 H350" strokeWidth="1" opacity="0.6" />
        <path d="M150 12 C158 12 160 5 166 5 C170 5 171 9 169 10.5" strokeWidth="1.3" />
        <path d="M210 12 C202 12 200 5 194 5 C190 5 189 9 191 10.5" strokeWidth="1.3" />
        <path d="M150 12 C158 12 160 19 166 19 C170 19 171 15 169 13.5" strokeWidth="1.3" />
        <path d="M210 12 C202 12 200 19 194 19 C190 19 189 15 191 13.5" strokeWidth="1.3" />
      </g>
      <path d="M180 4 L188 12 L180 20 L172 12 Z" fill="currentColor" />
      <circle cx="6" cy="12" r="2" fill="currentColor" opacity="0.7" />
      <circle cx="354" cy="12" r="2" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

/** Esquina de marco (se espeja con CSS). */
export function Esquina({ pos }: { pos: 'si' | 'sd' | 'ii' | 'id' }) {
  return (
    <svg className={`esquina ${pos}`} viewBox="0 0 26 26" aria-hidden="true">
      <path d="M3 24 V8 C3 5 5 3 8 3 H24" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 24 V11 C7 9 9 7 11 7 H24" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <path d="M3 3 L6.5 6.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1 1 L5 1 L5 5 L1 5 Z" fill="currentColor" transform="rotate(45 3 3)" />
    </svg>
  );
}

/** Icono de portada vacía. */
export function MascaraTeatro() {
  return (
    <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M10 10 C18 6 30 6 38 10 C38 26 32 38 24 40 C16 38 10 26 10 10 Z" />
        <path d="M17 19 C19 17 21 17 23 19" />
        <path d="M27 19 C29 17 31 17 33 19" />
        <path d="M18 29 C21 33 27 33 30 29" />
      </g>
    </svg>
  );
}

/** Partículas lentas tipo polvo/esporas en un canvas ligero. */
export function Fondo() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ajustar = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    ajustar();
    window.addEventListener('resize', ajustar);
    const ps = Array.from({ length: 46 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8,
      v: 0.004 + Math.random() * 0.012, f: Math.random() * Math.PI * 2, a: 0.15 + Math.random() * 0.45,
    }));
    let ultimo = performance.now();
    const dibujar = (t: number) => {
      const dt = Math.min(0.05, (t - ultimo) / 1000);
      ultimo = t;
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.y -= p.v * dt;
        p.f += dt * 0.6;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        const x = (p.x + Math.sin(p.f) * 0.01) * w;
        const y = p.y * h;
        const g = ctx.createRadialGradient(x, y, 0, x, y, p.r * 4);
        g.addColorStop(0, `rgba(236,230,214,${p.a})`);
        g.addColorStop(1, 'rgba(236,230,214,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reducir && !document.hidden) raf = requestAnimationFrame(dibujar);
    };
    raf = requestAnimationFrame(dibujar);
    const visibilidad = () => {
      if (!document.hidden && !reducir) {
        ultimo = performance.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(dibujar);
      }
    };
    document.addEventListener('visibilitychange', visibilidad);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', ajustar);
      document.removeEventListener('visibilitychange', visibilidad);
    };
  }, []);
  return (
    <div className="fondo" aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}
