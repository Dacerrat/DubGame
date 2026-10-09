import { useEffect, useMemo, useState } from 'react';
import type { Modo, PackResumen, RecetaResumen } from '../../../shared/tipos';
import { NOMBRES_TIPO, packJugable } from '../../../shared/reglas';
import type { Pantalla } from '../App';
import { api } from '../conexion';
import { Encabezado, Marco, TarjetaPack, useToast } from '../ui/componentes';

const TIPOS = ['todos', 'pelicula', 'disney', 'videojuego', 'serie', 'prueba'] as const;

export interface Seleccion {
  modo: Modo;
  nJugadores: number;
  elegido: string | null;
  onElegir: (id: string) => void;
}

export function useListaPacks() {
  const [packs, setPacks] = useState<PackResumen[] | null>(null);
  const [error, setError] = useState('');
  const recargar = () => api.packs().then(setPacks).catch((e) => setError(e.message));
  useEffect(() => {
    recargar();
  }, []);
  return { packs, error, recargar };
}

export function NavegadorPacks({ packs, seleccion, onAbrir, accion }: {
  packs: PackResumen[];
  seleccion?: Seleccion;
  onAbrir?: (p: PackResumen) => void;
  accion?: string;
}) {
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>('todos');
  const [personajes, setPersonajes] = useState<number | 'todos' | 'jugables'>(seleccion ? 'jugables' : 'todos');
  const [busqueda, setBusqueda] = useState('');

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return packs.filter((p) => {
      if (tipo !== 'todos' && p.tipo !== tipo) return false;
      if (personajes === 'jugables' && seleccion && !packJugable(p, seleccion.modo, seleccion.nJugadores)) return false;
      if (typeof personajes === 'number' && (personajes === 5 ? p.personajes.length < 5 : p.personajes.length !== personajes)) return false;
      if (q && !`${p.titulo} ${p.obra} ${p.personajes.map((x) => x.nombre).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [packs, tipo, personajes, busqueda, seleccion]);

  return (
    <div className="pila">
      <div className="fila" style={{ justifyContent: 'space-between' }}>
        <div className="pastillas">
          {TIPOS.map((t) => (
            <button key={t} className={`pastilla ${tipo === t ? 'activa' : ''}`} onClick={() => setTipo(t)}>
              {t === 'todos' ? 'Todos' : NOMBRES_TIPO[t]}
            </button>
          ))}
        </div>
        <input type="text" placeholder="Buscar…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ maxWidth: 260 }} />
      </div>
      <div className="pastillas">
        {seleccion && (
          <button className={`pastilla ${personajes === 'jugables' ? 'activa' : ''}`} onClick={() => setPersonajes('jugables')}>
            {seleccion.modo === 'personajes' ? `Para ${seleccion.nJugadores} jugadores` : 'Jugables'}
          </button>
        )}
        {(['todos', 1, 2, 3, 4, 5] as const).map((n) => (
          <button key={n} className={`pastilla ${personajes === n ? 'activa' : ''}`} onClick={() => setPersonajes(n)}>
            {n === 'todos' ? 'Cualquier reparto' : n === 5 ? '5+ personajes' : `${n} personaje${n > 1 ? 's' : ''}`}
          </button>
        ))}
      </div>
      {visibles.length === 0 ? (
        <p className="tenue centrado mt">
          No hay packs con estos filtros.
          {seleccion?.modo === 'personajes' && ' En el modo "un personaje por jugador" el pack necesita tantos personajes como jugadores.'}
        </p>
      ) : (
        <div className="rejilla-packs">
          {visibles.map((p) => {
            const bloqueo = seleccion && !packJugable(p, seleccion.modo, seleccion.nJugadores)
              ? `Necesita ${p.personajes.length} jugadores`
              : null;
            return (
              <TarjetaPack
                key={p.id}
                pack={p}
                elegida={seleccion?.elegido === p.id}
                bloqueada={bloqueo}
                accion={seleccion ? (bloqueo ? undefined : 'Seleccionar y jugar') : accion}
                onClick={() => {
                  if (seleccion) {
                    if (!bloqueo) seleccion.onElegir(p.id);
                  } else onAbrir?.(p);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Packs({ volver, local, ir }: { volver: () => void; local: boolean; ir: (p: Pantalla) => void }) {
  const { packs, error, recargar } = useListaPacks();
  const [pestana, setPestana] = useState<'packs' | 'recetas'>('packs');
  const [abierto, setAbierto] = useState<PackResumen | null>(null);
  const [toast, avisar] = useToast();

  const importar = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await api.importarPack(f);
      avisar(`Pack "${r.id}" importado`);
      recargar();
    } catch (e) {
      avisar((e as Error).message);
    }
  };

  return (
    <>
      <Encabezado
        titulo="Dub Packs"
        onVolver={volver}
        derecha={local ? <button className="boton peque" onClick={() => ir({ id: 'crearPack' })}>+ Crear pack</button> : undefined}
      />
      <div className="contenido pila">
        <div className="fila" style={{ justifyContent: 'space-between' }}>
          <div className="pastillas">
            <button className={`pastilla ${pestana === 'packs' ? 'activa' : ''}`} onClick={() => setPestana('packs')}>
              Packs instalados {packs ? `(${packs.length})` : ''}
            </button>
            <button className={`pastilla ${pestana === 'recetas' ? 'activa' : ''}`} onClick={() => setPestana('recetas')}>
              Escenas famosas (recetas)
            </button>
          </div>
          {local && pestana === 'packs' && (
            <label className="boton peque">
              Importar .dubpack
              <input type="file" accept=".dubpack,.zip" hidden onChange={(e) => importar(e.target.files?.[0])} />
            </label>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {pestana === 'packs' && (packs === null ? (
          <div className="cargando">CARGANDO…</div>
        ) : (
          <NavegadorPacks packs={packs} onAbrir={setAbierto} accion="Detalles" />
        ))}
        {pestana === 'recetas' && <Recetas local={local} ir={ir} />}
      </div>
      {abierto && (
        <DetallePack
          pack={abierto}
          local={local}
          cerrar={() => setAbierto(null)}
          editar={() => ir({ id: 'editor', packId: abierto.id })}
          borrado={() => {
            setAbierto(null);
            recargar();
            avisar('Pack borrado');
          }}
        />
      )}
      {toast}
    </>
  );
}

function DetallePack({ pack, local, cerrar, editar, borrado }: { pack: PackResumen; local: boolean; cerrar: () => void; editar: () => void; borrado: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'grid', placeItems: 'center', zIndex: 20, padding: 16 }} onClick={cerrar}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)' }}>
        <Marco titulo={pack.obra}>
          <h2 style={{ fontSize: 26, marginBottom: 10 }}>{pack.titulo}</h2>
          {pack.video && <video src={`/packs/${pack.id}/video.mp4`} controls style={{ width: '100%', background: '#000' }} poster={pack.portada ? `/packs/${pack.id}/portada.jpg` : undefined} />}
          <p className="tenue">Vídeo sin voces. El audio original está en el pack para la opción "escuchar original".</p>
          <div className="reparto-mini" style={{ marginBottom: 14 }}>
            {pack.personajes.map((p, i) => (
              <span key={p.id} style={{ borderColor: p.color }}>{p.nombre} · {pack.lineasPorPersonaje[i]} líneas</span>
            ))}
          </div>
          <div className="fila fin">
            <a className="boton peque" href={`/api/packs/${pack.id}/exportar`}>Exportar .dubpack</a>
            {local && <button className="boton peque" onClick={editar}>Editar</button>}
            {local && (
              <button
                className="boton peque peligro"
                onClick={async () => {
                  if (confirm(`¿Borrar el pack "${pack.titulo}"?`)) {
                    await api.borrarPack(pack.id);
                    borrado();
                  }
                }}
              >
                Borrar
              </button>
            )}
            <button className="boton peque" onClick={cerrar}>Cerrar</button>
          </div>
        </Marco>
      </div>
    </div>
  );
}

function Recetas({ local, ir }: { local: boolean; ir: (p: Pantalla) => void }) {
  const [recetas, setRecetas] = useState<RecetaResumen[] | null>(null);
  useEffect(() => {
    fetch('/api/recetas').then((r) => r.json()).then(setRecetas);
  }, []);
  if (!recetas) return <div className="cargando">CARGANDO…</div>;
  return (
    <Marco>
      <p className="tenue" style={{ marginTop: 0 }}>
        Las recetas son escenas famosas ya preparadas (personajes y guion en castellano). El motor descarga el clip,
        separa las voces, detecta quién habla y ajusta el guion al audio. Necesita conexión a internet en el ordenador servidor.
        También puedes prepararlas todas de golpe con <kbd>npm run packs:recetas</kbd>.
      </p>
      <table className="tabla-lineas">
        <tbody>
          {recetas.map((r) => (
            <tr key={r.id}>
              <td style={{ width: 120 }} className="tenue">{NOMBRES_TIPO[r.tipo]}</td>
              <td>
                <div>{r.titulo}</div>
                <div className="tenue" style={{ fontSize: 15 }}>{r.obra} · {r.personajes.join(', ')} · {r.nLineas} líneas</div>
              </td>
              <td style={{ width: 150, textAlign: 'right' }}>
                {r.preparada ? (
                  <span className="insignia">Instalada</span>
                ) : (
                  <button className="boton peque" disabled={!local} onClick={() => ir({ id: 'crearPack', receta: r.id })}>Preparar</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Marco>
  );
}
