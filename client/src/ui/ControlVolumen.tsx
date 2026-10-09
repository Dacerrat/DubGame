// Control del volumen de lo que oyes (vídeos, pitidos, clics...). Todos los
// controles comparten el mismo valor, que se recuerda en este navegador.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { VOLUMEN_MAX, cambiarVolumen, porcentajeAVolumen, suscribirVolumen, volumen, volumenAPorcentaje } from '../audio/motor';

const PASO = 5; // %
/** Desplazamiento de la rueda (px) que cuenta como un paso. */
const PASO_RUEDA = 40;
/** La rueda solo cambia el volumen si el puntero lleva este tiempo (ms) encima... */
const ESPERA_ENCIMA = 300;
/** ...y la página no se ha desplazado en este tiempo (ms): así no se cambia sin querer al bajar la página. */
const ESPERA_DESPLAZAMIENTO = 400;

let ultimoDesplazamiento = -Infinity;
if (typeof window !== 'undefined') {
  window.addEventListener('scroll', () => (ultimoDesplazamiento = performance.now()), { passive: true, capture: true });
}

/** Volumen al que se vuelve al quitar el silencio. */
let ultimoAudible = 1;

function IconoAltavoz({ porcentaje }: { porcentaje: number }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M3 9.5 H7 L12 5 V19 L7 14.5 H3 Z" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {porcentaje === 0 ? (
          <path d="M15.5 9.5 L20.5 14.5 M20.5 9.5 L15.5 14.5" />
        ) : (
          <>
            <path d="M15 9.2 C16.4 10.6 16.4 13.4 15 14.8" />
            {porcentaje > 50 && <path d="M17.6 7 C20.2 9.6 20.2 14.4 17.6 17" />}
            {porcentaje > 100 && <path d="M20.2 4.8 C24 8.6 24 15.4 20.2 19.2" opacity="0.8" />}
          </>
        )}
      </g>
    </svg>
  );
}

export function ControlVolumen({ etiqueta, testid = 'control-volumen' }: { etiqueta?: string; testid?: string }) {
  const valor = useSyncExternalStore(suscribirVolumen, volumen);
  const porcentaje = volumenAPorcentaje(valor);
  const ref = useRef<HTMLDivElement>(null);

  // Rueda del ratón encima del control: pasos de 5 %. Escucha nativa y no
  // pasiva para que la página no se desplace a la vez. Si el jugador está
  // bajando la página y el control pasa por debajo del puntero, no se toca.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let acumulado = 0;
    let encimaDesde = Infinity;
    const entrar = () => (encimaDesde = performance.now());
    const salir = () => (encimaDesde = Infinity);
    const rueda = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      const ahora = performance.now();
      const enfocado = el.contains(document.activeElement);
      if (!enfocado && (ahora - encimaDesde < ESPERA_ENCIMA || ahora - ultimoDesplazamiento < ESPERA_DESPLAZAMIENTO)) return;
      const actual = volumenAPorcentaje(volumen());
      const sube = e.deltaY < 0;
      // En los extremos, la rueda vuelve a desplazar la página
      if ((sube && actual >= VOLUMEN_MAX * 100) || (!sube && actual <= 0)) return;
      e.preventDefault();
      const d = e.deltaY * (e.deltaMode === 1 ? PASO_RUEDA : e.deltaMode === 2 ? 10 * PASO_RUEDA : 1);
      if (Math.sign(d) !== Math.sign(acumulado)) acumulado = 0;
      acumulado += d;
      // Un golpe de rueda es un paso; con el trackpad, un paso cada 40 px
      if (Math.abs(acumulado) < PASO_RUEDA) return;
      cambiarVolumen(porcentajeAVolumen(Math.round((actual + (acumulado < 0 ? PASO : -PASO)) / PASO) * PASO));
      acumulado = 0;
    };
    el.addEventListener('pointerenter', entrar);
    el.addEventListener('pointerleave', salir);
    el.addEventListener('wheel', rueda, { passive: false });
    return () => {
      el.removeEventListener('pointerenter', entrar);
      el.removeEventListener('pointerleave', salir);
      el.removeEventListener('wheel', rueda);
    };
  }, []);

  const silenciar = () => {
    if (porcentaje > 0) {
      ultimoAudible = valor;
      cambiarVolumen(0);
    } else {
      cambiarVolumen(ultimoAudible || 1);
    }
  };

  return (
    <div className="control-volumen" ref={ref} data-testid={testid}>
      {etiqueta && <span className="etiqueta">{etiqueta}</span>}
      <button
        type="button"
        className="altavoz"
        onClick={silenciar}
        aria-label={porcentaje === 0 ? 'Quitar silencio' : 'Silenciar'}
        title={porcentaje === 0 ? 'Quitar silencio' : 'Silenciar'}
      >
        <IconoAltavoz porcentaje={porcentaje} />
      </button>
      <input
        type="range"
        min={0}
        max={VOLUMEN_MAX * 100}
        step={PASO}
        value={porcentaje}
        onChange={(e) => cambiarVolumen(porcentajeAVolumen(Number(e.target.value)))}
        aria-label="Volumen"
        aria-valuetext={`${porcentaje} %`}
        title="Volumen de lo que oyes (no cambia lo que se graba ni lo que descargas)"
        style={{ '--f': porcentaje / (VOLUMEN_MAX * 100) } as React.CSSProperties}
      />
      <button
        type="button"
        className="cifra"
        onClick={() => cambiarVolumen(1)}
        title="Volver al 100 %"
        data-testid="volumen-porcentaje"
      >
        {porcentaje} %
      </button>
    </div>
  );
}
