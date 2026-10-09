import { useEffect, useMemo, useRef, useState } from 'react';
import type { Linea, Pack } from '../../../shared/tipos';
import { validarPack } from '../../../shared/reglas';
import { api } from '../conexion';
import { type AudioPack, type Reproduccion, cargarAudioPack, despertar, reproducir } from '../audio/motor';
import { Encabezado, Marco, useTeclas, useToast } from '../ui/componentes';

const COLORES = ['#e8d9b5', '#8fb8de', '#de8f8f', '#a6d98f', '#c9a6e0', '#e0bb85', '#85d0c9', '#d985b8'];
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function Editor({ packId, volver }: { packId: string; volver: () => void }) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [audio, setAudio] = useState<AudioPack | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [cabezal, setCabezal] = useState(0);
  const [cambios, setCambios] = useState(false);
  const [toast, avisar] = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const repRef = useRef<Reproduccion | null>(null);

  useEffect(() => {
    api.pack(packId).then(setPack).catch((e) => avisar(e.message));
    cargarAudioPack(packId).then(setAudio).catch((e) => avisar(e.message));
    return () => repRef.current?.parar();
  }, [packId, avisar]);

  useEffect(() => {
    let raf = 0;
    const f = () => {
      if (repRef.current) setCabezal(repRef.current.posicion());
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, []);

  const modificar = (f: (p: Pack) => Pack) => {
    setPack((p) => (p ? f(structuredClone(p)) : p));
    setCambios(true);
  };
  const cambiarLinea = (id: string, c: Partial<Linea>) =>
    modificar((p) => ({ ...p, lineas: p.lineas.map((l) => (l.id === id ? { ...l, ...c, confianza: 1 } : l)) }));

  const tocar = async (desde: number, hasta: number, conVoces = true) => {
    if (!audio || !pack) return;
    repRef.current?.parar();
    await despertar();
    const rep = reproducir({
      desde: Math.max(0, desde),
      hasta: Math.min(pack.duracion, hasta),
      video: videoRef.current,
      pistas: [{ buffer: audio.fondo, en: 0 }, ...(conVoces ? [{ buffer: audio.voces, en: 0 }] : [])],
    });
    repRef.current = rep;
    await rep.terminada;
    if (repRef.current === rep) repRef.current = null;
  };
  const parar = () => {
    repRef.current?.parar();
    repRef.current = null;
  };

  const nuevoId = (p: Pack) => {
    let k = p.lineas.length + 1;
    while (p.lineas.some((l) => l.id === `l${String(k).padStart(2, '0')}`)) k++;
    return `l${String(k).padStart(2, '0')}`;
  };

  const dividir = (id: string) => modificar((p) => {
    const i = p.lineas.findIndex((l) => l.id === id);
    const l = p.lineas[i];
    const medio = r3((l.inicio + l.fin) / 2);
    const palabras = l.texto.split(/\s+/);
    const corte = Math.ceil(palabras.length / 2);
    const nueva: Linea = { ...l, id: nuevoId(p), inicio: medio, texto: palabras.slice(corte).join(' '), textoOriginal: '' };
    p.lineas.splice(i, 1, { ...l, fin: medio, texto: palabras.slice(0, corte).join(' ') }, nueva);
    return p;
  });

  const unir = (id: string) => modificar((p) => {
    const orden = [...p.lineas].sort((a, b) => a.inicio - b.inicio);
    const i = orden.findIndex((l) => l.id === id);
    const a = orden[i];
    const b = orden[i + 1];
    if (!b) return p;
    p.lineas = p.lineas
      .filter((l) => l.id !== b.id)
      .map((l) => (l.id === a.id ? { ...a, fin: b.fin, texto: `${a.texto} ${b.texto}`.trim(), textoOriginal: `${a.textoOriginal ?? ''} ${b.textoOriginal ?? ''}`.trim() } : l));
    return p;
  });

  const borrar = (id: string) => modificar((p) => ({ ...p, lineas: p.lineas.filter((l) => l.id !== id) }));

  const anadir = () => modificar((p) => {
    const id = nuevoId(p);
    const ini = r3(Math.max(0, Math.min(cabezal, p.duracion - 1)));
    p.lineas.push({ id, personaje: p.personajes[0].id, inicio: ini, fin: r3(Math.min(p.duracion, ini + 1.5)), texto: '', confianza: 1 });
    setSel(id);
    return p;
  });

  const guardar = async () => {
    if (!pack) return;
    const error = validarPack(pack);
    if (error) return avisar(error);
    try {
      const r = await api.guardarPack(pack);
      setPack(r.pack);
      setCambios(false);
      avisar('Pack guardado');
    } catch (e) {
      avisar((e as Error).message);
    }
  };

  const ordenadas = useMemo(() => (pack ? [...pack.lineas].sort((a, b) => a.inicio - b.inicio) : []), [pack]);
  const lineaSel = ordenadas.find((l) => l.id === sel);

  useTeclas({
    Espacio: () => (repRef.current ? parar() : lineaSel ? tocar(lineaSel.inicio - 0.3, lineaSel.fin + 0.2) : undefined),
  });

  if (!pack) return <div className="cargando">CARGANDO PACK…</div>;
  const usados = new Set(pack.lineas.map((l) => l.personaje));
  const dudosas = pack.lineas.filter((l) => (l.confianza ?? 1) < 0.45).length;

  return (
    <>
      <Encabezado
        titulo="Editor de pack"
        onVolver={() => (!cambios || confirm('Hay cambios sin guardar. ¿Salir igualmente?')) && volver()}
        derecha={<button className="boton primario peque" disabled={!cambios} onClick={guardar}>Guardar</button>}
      />
      <div className="contenido pila">
        <div className="columnas" style={{ gridTemplateColumns: '1fr 360px' }}>
          <div className="pantalla-video">
            <video ref={videoRef} src={`/packs/${pack.id}/video.mp4`} muted playsInline preload="auto" />
          </div>
          <Marco titulo="Datos">
            <div className="campo">
              <label>Título</label>
              <input type="text" value={pack.titulo} onChange={(e) => modificar((p) => ({ ...p, titulo: e.target.value }))} />
            </div>
            <div className="campo">
              <label>Obra</label>
              <input type="text" value={pack.obra} onChange={(e) => modificar((p) => ({ ...p, obra: e.target.value }))} />
            </div>
            <div className="campo">
              <label>Autor</label>
              <input type="text" value={pack.autor} onChange={(e) => modificar((p) => ({ ...p, autor: e.target.value }))} />
            </div>
            <div className="etiqueta" style={{ marginBottom: 6 }}>Personajes</div>
            {pack.personajes.map((q) => (
              <div key={q.id} className="fila" style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
                <input type="color" value={q.color} onChange={(e) => modificar((p) => ({ ...p, personajes: p.personajes.map((x) => (x.id === q.id ? { ...x, color: e.target.value } : x)) }))} style={{ width: 36, height: 32, padding: 0, border: 'none', background: 'none' }} />
                <input type="text" value={q.nombre} onChange={(e) => modificar((p) => ({ ...p, personajes: p.personajes.map((x) => (x.id === q.id ? { ...x, nombre: e.target.value } : x)) }))} />
                <button className="boton peque fantasma" disabled={usados.has(q.id) || pack.personajes.length <= 1} title={usados.has(q.id) ? 'Tiene líneas' : 'Quitar'} onClick={() => modificar((p) => ({ ...p, personajes: p.personajes.filter((x) => x.id !== q.id) }))}>✕</button>
              </div>
            ))}
            <button
              className="boton peque"
              onClick={() => modificar((p) => {
                let k = p.personajes.length + 1;
                while (p.personajes.some((x) => x.id === `p${k}`)) k++;
                p.personajes.push({ id: `p${k}`, nombre: `Personaje ${k}`, color: COLORES[(k - 1) % COLORES.length] });
                return p;
              })}
            >
              + Personaje
            </button>
          </Marco>
        </div>

        <FormaOnda
          pack={pack}
          audio={audio}
          sel={sel}
          cabezal={cabezal}
          onSel={setSel}
          onCabezal={(t) => {
            setCabezal(t);
            if (videoRef.current) videoRef.current.currentTime = t;
          }}
          onBordes={(id, inicio, fin) => cambiarLinea(id, { inicio: r3(inicio), fin: r3(fin) })}
        />
        <div className="fila" style={{ justifyContent: 'space-between' }}>
          <div className="fila">
            <button className="boton peque" onClick={() => tocar(cabezal, pack.duracion)}>▶ Desde el cabezal</button>
            <button className="boton peque" onClick={() => tocar(cabezal, pack.duracion, false)}>▶ Sin voces</button>
            <button className="boton peque" onClick={parar}>■ Parar</button>
            <button className="boton peque" onClick={anadir}>+ Línea en el cabezal</button>
          </div>
          <span className={dudosas ? 'aviso' : 'tenue'}>
            {pack.lineas.length} líneas{dudosas ? ` · ${dudosas} por revisar` : ''} · Estado: {pack.estado}
          </span>
        </div>

        <Marco>
          <table className="tabla-lineas">
            <tbody>
              {ordenadas.map((l) => {
                const dudosa = (l.confianza ?? 1) < 0.45;
                return (
                  <tr key={l.id} className={sel === l.id ? 'sel' : ''} onClick={() => setSel(l.id)}>
                    <td style={{ width: 34 }}>
                      <button className="boton peque fantasma" title="Escuchar" onClick={() => tocar(l.inicio - 0.3, l.fin + 0.2)}>▶</button>
                    </td>
                    <td style={{ width: 150 }}>
                      <select value={l.personaje} onChange={(e) => cambiarLinea(l.id, { personaje: e.target.value })} style={{ borderLeft: `3px solid ${pack.personajes.find((q) => q.id === l.personaje)?.color}` }}>
                        {pack.personajes.map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
                      </select>
                    </td>
                    <td style={{ width: 200 }}>
                      <div className="fila" style={{ flexWrap: 'nowrap', gap: 4 }}>
                        <input type="number" step={0.05} min={0} value={l.inicio} onChange={(e) => cambiarLinea(l.id, { inicio: r3(Number(e.target.value)) })} />
                        <input type="number" step={0.05} min={0} value={l.fin} onChange={(e) => cambiarLinea(l.id, { fin: r3(Number(e.target.value)) })} />
                      </div>
                    </td>
                    <td>
                      <input type="text" value={l.texto} placeholder="Texto en castellano" onChange={(e) => cambiarLinea(l.id, { texto: e.target.value })} style={dudosa ? { borderColor: 'var(--ambar)' } : undefined} />
                      {l.textoOriginal && l.textoOriginal !== l.texto && (
                        <div className="orig">
                          Se oye: «{l.textoOriginal}»{' '}
                          <button className="boton peque fantasma" onClick={() => cambiarLinea(l.id, { texto: l.textoOriginal! })}>usar</button>
                        </div>
                      )}
                    </td>
                    <td style={{ width: 120, whiteSpace: 'nowrap' }}>
                      <button className="boton peque fantasma" title="Dividir" onClick={() => dividir(l.id)}>⌿</button>
                      <button className="boton peque fantasma" title="Unir con la siguiente" onClick={() => unir(l.id)}>⤓</button>
                      <button className="boton peque fantasma" title="Borrar" onClick={() => borrar(l.id)}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Marco>
      </div>
      {toast}
    </>
  );
}

function FormaOnda({ pack, audio, sel, cabezal, onSel, onCabezal, onBordes }: {
  pack: Pack;
  audio: AudioPack | null;
  sel: string | null;
  cabezal: number;
  onSel: (id: string) => void;
  onCabezal: (t: number) => void;
  onBordes: (id: string, inicio: number, fin: number) => void;
}) {
  const cont = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [ancho, setAncho] = useState(1000);
  const pps = Math.max(ancho / pack.duracion, 60); // píxeles por segundo
  const total = pack.duracion * pps;

  useEffect(() => {
    const el = cont.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAncho(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = lienzo.current;
    if (!c || !audio) return;
    const w = Math.ceil(total);
    const h = 120;
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    const d = audio.voces.getChannelData(0);
    const porPx = d.length / w;
    g.fillStyle = 'rgba(236,230,214,0.35)';
    for (let x = 0; x < w; x++) {
      let m = 0;
      const a = Math.floor(x * porPx);
      const b = Math.min(d.length, Math.floor((x + 1) * porPx));
      for (let i = a; i < b; i += 4) m = Math.max(m, Math.abs(d[i]));
      const alto = Math.min(1, m * 1.6) * (h / 2 - 4);
      g.fillRect(x, h / 2 - alto, 1, alto * 2);
    }
  }, [audio, total]);

  const arrastrar = (e: React.PointerEvent, l: Linea, borde: 'i' | 'd') => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const { inicio, fin } = l;
    const mover = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps;
      if (borde === 'i') onBordes(l.id, Math.max(0, Math.min(fin - 0.2, inicio + dt)), fin);
      else onBordes(l.id, inicio, Math.min(pack.duracion, Math.max(inicio + 0.2, fin + dt)));
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };

  return (
    <div ref={cont} style={{ overflowX: 'auto' }}>
      <div
        className="forma-onda"
        style={{ width: total }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onCabezal(Math.max(0, Math.min(pack.duracion, (e.clientX - r.left) / pps)));
        }}
      >
        <canvas ref={lienzo} style={{ width: total }} />
        {pack.lineas.map((l) => {
          const color = pack.personajes.find((q) => q.id === l.personaje)?.color ?? '#fff';
          return (
            <div
              key={l.id}
              className={`bloque ${sel === l.id ? 'sel' : ''}`}
              style={{ left: l.inicio * pps, width: Math.max(4, (l.fin - l.inicio) * pps), borderColor: color, color }}
              title={l.texto}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSel(l.id);
              }}
            >
              <span className="tirador i" onPointerDown={(e) => arrastrar(e, l, 'i')} />
              {l.texto}
              <span className="tirador d" onPointerDown={(e) => arrastrar(e, l, 'd')} />
            </div>
          );
        })}
        <div className="cabezal" style={{ left: cabezal * pps }} />
      </div>
    </div>
  );
}
