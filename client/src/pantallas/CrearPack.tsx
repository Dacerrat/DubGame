import { useEffect, useState } from 'react';
import type { RecetaResumen, TrabajoCreador } from '../../../shared/tipos';
import { NOMBRES_TIPO } from '../../../shared/reglas';
import type { Pantalla } from '../App';
import { socket } from '../conexion';
import { Encabezado, Marco, Selector } from '../ui/componentes';

const FASES: Record<string, string> = {
  inicio: 'Arrancando',
  modelos: 'Modelos',
  descargar: 'Descargando',
  audio: 'Audio',
  separar: 'Separando voces',
  vad: 'Detectando voz',
  diarizar: 'Quién habla',
  transcribir: 'Transcribiendo',
  alinear: 'Ajustando guion',
  exportar: 'Exportando',
  listo: 'Listo',
};

export function CrearPack({ volver, receta: recetaInicial, ir }: { volver: () => void; receta?: string; ir: (p: Pantalla) => void }) {
  const [origen, setOrigen] = useState<'receta' | 'url' | 'archivo'>(recetaInicial ? 'receta' : 'url');
  const [recetas, setRecetas] = useState<RecetaResumen[]>([]);
  const [receta, setReceta] = useState(recetaInicial ?? '');
  const [url, setUrl] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState('pelicula');
  const [idioma, setIdioma] = useState('es');
  const [hablantes, setHablantes] = useState('auto');
  const [modelo, setModelo] = useState<'base' | 'small' | 'medium'>('small');
  const [separacion, setSeparacion] = useState<'spleeter' | 'uvr'>('spleeter');
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const [trabajo, setTrabajo] = useState<TrabajoCreador | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/recetas').then((r) => r.json()).then((rs: RecetaResumen[]) => {
      setRecetas(rs);
      if (!recetaInicial && rs.length) setReceta(rs.find((r) => !r.preparada)?.id ?? rs[0].id);
    });
  }, [recetaInicial]);

  useEffect(() => {
    if (!trabajo || trabajo.estado !== 'en-curso') return;
    socket.emit('creador:suscribir');
    const f = (t: TrabajoCreador) => t.id === trabajo.id && setTrabajo(t);
    socket.on('creador:progreso', f);
    const sondeo = setInterval(() => {
      fetch(`/api/creador/${trabajo.id}`).then((r) => r.json()).then((t: TrabajoCreador) => setTrabajo(t)).catch(() => {});
    }, 4000);
    return () => {
      socket.off('creador:progreso', f);
      clearInterval(sondeo);
    };
  }, [trabajo?.id, trabajo?.estado]);

  const lanzar = async () => {
    setError('');
    const fd = new FormData();
    if (origen === 'receta') fd.set('receta', receta);
    if (origen === 'url') fd.set('url', url);
    if (origen === 'archivo' && archivo) fd.set('video', archivo);
    if (origen !== 'receta') {
      if (titulo) fd.set('titulo', titulo);
      fd.set('tipo', tipo);
      fd.set('idioma', idioma);
      if (hablantes !== 'auto') fd.set('hablantes', hablantes);
    }
    if (inicio) fd.set('inicio', inicio);
    if (fin) fd.set('fin', fin);
    fd.set('modelo', modelo);
    fd.set('separacion', separacion);
    fd.set('forzar', '1');
    try {
      const r = await fetch('/api/creador', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setTrabajo(d);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const valido = origen === 'receta' ? !!receta : origen === 'url' ? /^https?:\/\//.test(url) : !!archivo;
  const r = recetas.find((x) => x.id === receta);

  if (trabajo) {
    const pct = trabajo.fraccion !== null ? Math.round(trabajo.fraccion * 100) : null;
    return (
      <>
        <Encabezado titulo="Creando pack" onVolver={trabajo.estado === 'en-curso' ? undefined : volver} />
        <div className="estrecho" style={{ maxWidth: 620 }}>
          <Marco titulo={FASES[trabajo.fase] ?? trabajo.fase}>
            <p style={{ fontSize: 22, marginTop: 0 }}>{trabajo.estado === 'error' ? 'Algo ha fallado' : trabajo.mensaje}</p>
            {trabajo.estado === 'en-curso' && (
              <div className="barra" style={{ height: 6 }}>
                <div style={{ width: pct !== null ? `${pct}%` : '100%', opacity: pct !== null ? 1 : 0.3 }} />
              </div>
            )}
            <div className="pastillas mt">
              {Object.entries(FASES).filter(([k]) => k !== 'inicio' && k !== 'modelos').map(([k, v]) => (
                <span key={k} className={`pastilla ${k === trabajo.fase ? 'activa' : ''}`} style={{ cursor: 'default' }}>{v}</span>
              ))}
            </div>
            {trabajo.error && <p className="error">{trabajo.error}</p>}
            {trabajo.estado === 'terminado' && trabajo.packId && (
              <div className="fila fin mt">
                <button className="boton" onClick={volver}>Ver packs</button>
                <button className="boton primario" onClick={() => ir({ id: 'editor', packId: trabajo.packId! })}>Revisar en el editor</button>
              </div>
            )}
            {trabajo.estado === 'error' && (
              <div className="fila fin mt">
                <button className="boton" onClick={() => setTrabajo(null)}>Volver a intentarlo</button>
              </div>
            )}
            {trabajo.estado === 'en-curso' && (
              <p className="tenue">La primera vez se descargan los modelos (unos cientos de MB). Después va mucho más rápido.</p>
            )}
          </Marco>
        </div>
      </>
    );
  }

  return (
    <>
      <Encabezado titulo="Crear pack" onVolver={volver} />
      <div className="estrecho" style={{ maxWidth: 680 }}>
        <Marco titulo="Origen">
          <div className="pastillas" style={{ marginBottom: 14 }}>
            <button className={`pastilla ${origen === 'receta' ? 'activa' : ''}`} onClick={() => setOrigen('receta')}>Escena famosa</button>
            <button className={`pastilla ${origen === 'url' ? 'activa' : ''}`} onClick={() => setOrigen('url')}>Enlace (YouTube…)</button>
            <button className={`pastilla ${origen === 'archivo' ? 'activa' : ''}`} onClick={() => setOrigen('archivo')}>Archivo de vídeo</button>
          </div>
          {origen === 'receta' && (
            <div className="campo">
              <label>Receta</label>
              <select value={receta} onChange={(e) => setReceta(e.target.value)}>
                {recetas.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.preparada ? '✓ ' : ''}{x.titulo} — {NOMBRES_TIPO[x.tipo]} · {x.personajes.length} pers.
                  </option>
                ))}
              </select>
              {r && <p className="tenue" style={{ margin: 0 }}>{r.obra} · {r.personajes.join(', ')} · {r.nLineas} líneas. Se busca el clip automáticamente.</p>}
            </div>
          )}
          {origen === 'url' && (
            <div className="campo">
              <label htmlFor="url">Enlace del vídeo</label>
              <input id="url" type="url" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
          )}
          {origen === 'archivo' && (
            <div className="campo">
              <label>Archivo</label>
              <input type="file" accept="video/*,audio/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
            </div>
          )}
          <div className="fila">
            <div className="campo" style={{ flex: 1 }}>
              <label htmlFor="ini">Desde (opcional)</label>
              <input id="ini" type="text" placeholder="1:23" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div className="campo" style={{ flex: 1 }}>
              <label htmlFor="fin">Hasta (opcional)</label>
              <input id="fin" type="text" placeholder="2:40" value={fin} onChange={(e) => setFin(e.target.value)} />
            </div>
          </div>
        </Marco>

        {origen !== 'receta' && (
          <Marco titulo="Datos del pack" style={{ marginTop: 18 }}>
            <div className="campo">
              <label htmlFor="tit">Título</label>
              <input id="tit" type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Shrek — El hombre de las magdalenas" />
            </div>
            <Selector
              nombre="Tipo"
              valor={tipo}
              opciones={['pelicula', 'disney', 'videojuego', 'serie'].map((t) => ({ valor: t, texto: NOMBRES_TIPO[t] }))}
              onCambio={setTipo}
            />
            <Selector
              nombre="Idioma del audio"
              valor={idioma}
              ayuda="Si no es castellano, tendrás que escribir el texto en el editor."
              opciones={[
                { valor: 'es', texto: 'Castellano' }, { valor: 'en', texto: 'Inglés' }, { valor: 'ja', texto: 'Japonés' },
                { valor: 'fr', texto: 'Francés' }, { valor: 'it', texto: 'Italiano' }, { valor: 'de', texto: 'Alemán' },
                { valor: 'pt', texto: 'Portugués' }, { valor: 'auto', texto: 'Detectar' },
              ]}
              onCambio={setIdioma}
            />
            <Selector
              nombre="Personajes"
              valor={hablantes}
              ayuda="Si lo sabes, la detección de voces acierta más."
              opciones={[{ valor: 'auto', texto: 'Detectar' }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ valor: String(n), texto: String(n) }))]}
              onCambio={setHablantes}
            />
          </Marco>
        )}

        <Marco titulo="Calidad" style={{ marginTop: 18 }}>
          <Selector
            nombre="Transcripción"
            valor={modelo}
            opciones={[
              { valor: 'base', texto: 'Rápida' },
              { valor: 'small', texto: 'Equilibrada' },
              { valor: 'medium', texto: 'Precisa (lenta)' },
            ]}
            onCambio={setModelo}
          />
          <Selector
            nombre="Separar voces"
            valor={separacion}
            opciones={[
              { valor: 'spleeter', texto: 'Rápido' },
              { valor: 'uvr', texto: 'Mejor calidad' },
            ]}
            onCambio={setSeparacion}
          />
        </Marco>
        {error && <p className="error">{error}</p>}
        <div className="fila fin mt">
          <button className="boton primario grande" disabled={!valido} onClick={lanzar}>Crear pack</button>
        </div>
      </div>
    </>
  );
}
