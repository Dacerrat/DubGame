import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PackResumen } from '../../../shared/tipos';
import { NOMBRES_TIPO, formatoDuracion, formatoTamano } from '../../../shared/reglas';
import { Esquina, MascaraTeatro, OrnamentoOpcion, Separador } from './ornamentos';

export function Marco({ titulo, children, className = '', style }: { titulo?: string; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={`marco ${className}`} style={style}>
      <Esquina pos="si" />
      <Esquina pos="sd" />
      <Esquina pos="ii" />
      <Esquina pos="id" />
      {titulo && <h3>{titulo}</h3>}
      {children}
    </section>
  );
}

export function Opcion({ children, onClick, disabled, autoFocus, testid }: { children: ReactNode; onClick: () => void; disabled?: boolean; autoFocus?: boolean; testid?: string }) {
  return (
    <button className="opcion" onClick={onClick} disabled={disabled} autoFocus={autoFocus} data-testid={testid}>
      <OrnamentoOpcion lado="izq" />
      {children}
      <OrnamentoOpcion lado="der" />
    </button>
  );
}

export function Encabezado({ titulo, onVolver, derecha }: { titulo: string; onVolver?: () => void; derecha?: ReactNode }) {
  return (
    <>
      <div className="encabezado">
        <div className="lado">{onVolver && <button className="volver" onClick={onVolver}>‹ VOLVER</button>}</div>
        <h2>{titulo}</h2>
        <div className="lado">{derecha}</div>
      </div>
      <Separador ancho={420} />
    </>
  );
}

/** Selector estilo menú de opciones: "Nombre   ‹ Valor ›". */
export function Selector<T extends string>({ nombre, valor, opciones, onCambio, deshabilitado, ayuda, testid }: {
  nombre: string;
  valor: T;
  opciones: { valor: T; texto: string }[];
  onCambio: (v: T) => void;
  deshabilitado?: boolean;
  ayuda?: string;
  testid?: string;
}) {
  const i = Math.max(0, opciones.findIndex((o) => o.valor === valor));
  const mover = (d: number) => onCambio(opciones[(i + d + opciones.length) % opciones.length].valor);
  return (
    <div className="selector" data-testid={testid}>
      <div>
        <div className="nombre">{nombre}</div>
        {ayuda && <div className="ayuda">{ayuda}</div>}
      </div>
      <div className="valor">
        <button className="flecha" disabled={deshabilitado} onClick={() => mover(-1)} aria-label="Anterior">‹</button>
        <span>{opciones[i]?.texto}</span>
        <button className="flecha" disabled={deshabilitado} onClick={() => mover(1)} aria-label="Siguiente">›</button>
      </div>
    </div>
  );
}

export function TarjetaPack({ pack, onClick, elegida, bloqueada, accion, pie }: {
  pack: PackResumen;
  onClick?: () => void;
  elegida?: boolean;
  bloqueada?: string | null;
  accion?: string;
  pie?: ReactNode;
}) {
  return (
    <button
      className={`tarjeta-pack ${elegida ? 'elegida' : ''} ${bloqueada ? 'bloqueada' : ''}`}
      onClick={onClick}
      title={bloqueada ?? undefined}
      data-testid={`pack-${pack.id}`}
    >
      <div className="portada" style={pack.portada ? { backgroundImage: `url(/packs/${pack.id}/portada.jpg)` } : undefined}>
        {!pack.portada && <MascaraTeatro />}
        <span className="tipo">{NOMBRES_TIPO[pack.tipo] ?? pack.tipo}</span>
        <span className="lineas">{pack.nLineas} LÍNEAS</span>
      </div>
      <div className="cuerpo">
        <div className="autor">Dub pack · {pack.autor}</div>
        <div className="nombre-pack">{pack.titulo}</div>
        <div className="meta">
          {formatoDuracion(pack.duracion)} · {formatoTamano(pack.tamano)} ·{' '}
          <span className={pack.estado}>{pack.estado === 'listo' ? 'LISTO' : 'REVISAR'}</span>
        </div>
        <div className="reparto-mini">
          {pack.personajes.map((p, i) => (
            <span key={p.id} style={{ borderColor: p.color }}>{p.nombre} · {pack.lineasPorPersonaje[i]}</span>
          ))}
        </div>
        {bloqueada && <div className="aviso" style={{ fontSize: 14 }}>{bloqueada}</div>}
        {accion && <div className="cinzel" style={{ fontSize: 12, letterSpacing: '0.2em', marginTop: 6 }}>{accion} ›</div>}
        {pie}
      </div>
    </button>
  );
}

export function useToast(): [ReactNode, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mostrar = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(null), 3500);
  }, []);
  useEffect(() => () => clearTimeout(t.current), []);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, mostrar];
}

/** Atajos de teclado (se ignoran mientras se escribe en un campo). */
export function useTeclas(mapa: Record<string, () => void>, activo = true) {
  const ref = useRef(mapa);
  ref.current = mapa;
  useEffect(() => {
    if (!activo) return;
    const f = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const k = e.key === ' ' ? 'Espacio' : e.key;
      const fn = ref.current[k] ?? ref.current[k.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [activo]);
}
