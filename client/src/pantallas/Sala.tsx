import { useEffect, useMemo, useState } from 'react';
import type { EstadoSala, Pack } from '../../../shared/tipos';
import { configValida, formatoDuracion } from '../../../shared/reglas';
import { acciones, api } from '../conexion';
import { Encabezado, Marco, Selector, useToast } from '../ui/componentes';
import { NavegadorPacks, useListaPacks } from './Packs';

export function usePack(id: string | null): Pack | null {
  const [pack, setPack] = useState<Pack | null>(null);
  useEffect(() => {
    if (!id) {
      setPack(null);
      return;
    }
    let vivo = true;
    api.pack(id).then((p) => vivo && setPack(p)).catch(() => vivo && setPack(null));
    return () => {
      vivo = false;
    };
  }, [id]);
  return pack;
}

export function Sala({ sala, yo }: { sala: EstadoSala; yo: string }) {
  const soyAnfitrion = sala.anfitrion === yo;
  const conectados = sala.jugadores.filter((j) => j.conectado);
  const { packs } = useListaPacks();
  const pack = usePack(sala.config.packId);
  const [eligiendo, setEligiendo] = useState(false);
  const [toast, avisar] = useToast();
  const resumen = packs?.find((p) => p.id === sala.config.packId) ?? null;
  const problema = configValida(sala.config, resumen, conectados.length);
  const enlace = `${location.origin}/?sala=${sala.codigo}`;

  const hacer = (p: Promise<unknown>) => p.catch((e: Error) => avisar(e.message));

  const ocupados = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [j, p] of Object.entries(sala.preferencias)) m[p] = j;
    return m;
  }, [sala.preferencias]);
  const nombre = (id: string) => sala.jugadores.find((j) => j.id === id)?.nombre ?? '—';

  if (eligiendo && soyAnfitrion) {
    return (
      <>
        <Encabezado titulo="Elegir Dub Pack" onVolver={() => setEligiendo(false)} />
        <div className="contenido">
          {packs ? (
            <NavegadorPacks
              packs={packs}
              seleccion={{
                modo: sala.config.modo,
                nJugadores: conectados.length,
                elegido: sala.config.packId,
                onElegir: (id) => hacer(acciones.configurar({ packId: id }).then(() => setEligiendo(false))),
              }}
            />
          ) : (
            <div className="cargando">CARGANDO…</div>
          )}
        </div>
        {toast}
      </>
    );
  }

  return (
    <>
      <Encabezado
        titulo="Sala de espera"
        onVolver={() => {
          if (confirm('¿Salir de la sala?')) acciones.salir();
        }}
        derecha={<span className="tenue">Ronda {sala.ronda + 1}</span>}
      />
      <div className="contenido columnas">
        <div className="pila">
          <Marco titulo="Código de sala">
            <div className="codigo-sala" data-testid="codigo-sala">{sala.codigo}</div>
            <div className="fila centro mt">
              <button
                className="boton peque"
                onClick={() => navigator.clipboard?.writeText(enlace).then(() => avisar('Enlace copiado'), () => avisar(enlace))}
              >
                Copiar enlace
              </button>
            </div>
          </Marco>
          <Marco titulo={`Jugadores (${conectados.length})`}>
            <ul className="jugadores" data-testid="lista-jugadores">
              {sala.jugadores.map((j) => (
                <li key={j.id}>
                  <span className={`punto ${j.conectado ? '' : 'off'}`} />
                  <span className="nombre">
                    {j.nombre}
                    {j.id === yo && <span className="tenue"> (tú)</span>}
                  </span>
                  {j.puntos > 0 && <span className="tenue">{j.puntos} pts</span>}
                  {j.id === sala.anfitrion && <span className="insignia">Anfitrión</span>}
                  {soyAnfitrion && j.id !== yo && (
                    <button className="boton peque fantasma" title="Expulsar" onClick={() => hacer(acciones.expulsar(j.id))}>✕</button>
                  )}
                </li>
              ))}
            </ul>
          </Marco>
        </div>

        <div className="pila">
          <Marco titulo="Partida">
            <Selector
              nombre="Modo de juego"
              testid="selector-modo"
              valor={sala.config.modo}
              deshabilitado={!soyAnfitrion}
              ayuda={sala.config.modo === 'personajes'
                ? 'Cada jugador dobla un personaje. Escenas con tantos personajes como jugadores.'
                : 'Cada jugador dobla la escena entera y luego se comparan y se votan.'}
              opciones={[
                { valor: 'personajes', texto: 'Un personaje cada uno' },
                { valor: 'solitario', texto: 'En solitario' },
              ]}
              onCambio={(modo) => hacer(acciones.configurar({ modo }))}
            />
            <Selector
              nombre="Escuchar la voz original"
              testid="selector-original"
              valor={sala.config.escucharOriginal ? 'si' : 'no'}
              deshabilitado={!soyAnfitrion}
              ayuda="Oír al personaje en la parte que estás doblando (como guía)."
              opciones={[
                { valor: 'si', texto: 'Sí' },
                { valor: 'no', texto: 'No' },
              ]}
              onCambio={(v) => hacer(acciones.configurar({ escucharOriginal: v === 'si' }))}
            />
            {sala.config.modo === 'personajes' && (
              <Selector
                nombre="Reparto de personajes"
                valor={sala.config.reparto}
                deshabilitado={!soyAnfitrion}
                opciones={[
                  { valor: 'aleatorio', texto: 'Aleatorio' },
                  { valor: 'elegir', texto: 'Cada uno elige' },
                ]}
                onCambio={(reparto) => hacer(acciones.configurar({ reparto }))}
              />
            )}
          </Marco>

          <Marco titulo="Dub Pack">
            {resumen ? (
              <div className="fila" style={{ alignItems: 'flex-start', gap: 16 }}>
                <div
                  className="portada"
                  style={{ width: 200, flex: 'none', border: '1px solid var(--linea)', backgroundImage: resumen.portada ? `url(/packs/${resumen.id}/portada.jpg)` : undefined }}
                />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 24 }} data-testid="pack-elegido">{resumen.titulo}</div>
                  <div className="tenue">{resumen.obra} · {formatoDuracion(resumen.duracion)} · {resumen.nLineas} líneas</div>
                  {soyAnfitrion && <button className="boton peque mt" onClick={() => setEligiendo(true)}>Cambiar pack</button>}
                </div>
              </div>
            ) : soyAnfitrion ? (
              <button className="boton grande" onClick={() => setEligiendo(true)} data-testid="elegir-pack">Elegir pack</button>
            ) : (
              <p className="tenue">El anfitrión está eligiendo escena…</p>
            )}

            {pack && sala.config.modo === 'personajes' && (
              <div className="mt">
                <div className="etiqueta" style={{ marginBottom: 6 }}>
                  {sala.config.reparto === 'elegir' ? 'Elige tu personaje' : 'Personajes (se repartirán al azar)'}
                </div>
                <div className="pila" style={{ gap: 6 }}>
                  {pack.personajes.map((p) => {
                    const n = pack.lineas.filter((l) => l.personaje === p.id).length;
                    const de = ocupados[p.id];
                    const mio = de === yo;
                    return (
                      <div key={p.id} className="fila" style={{ justifyContent: 'space-between', borderLeft: `3px solid ${p.color}`, paddingLeft: 10 }}>
                        <span>
                          {p.nombre} <span className="tenue">· {n} líneas</span>
                        </span>
                        {sala.config.reparto === 'elegir' && (
                          de ? (
                            <span className="fila">
                              <span className={mio ? '' : 'tenue'}>{nombre(de)}</span>
                              {mio && <button className="boton peque fantasma" onClick={() => hacer(acciones.elegirPersonaje(null))}>Soltar</button>}
                            </span>
                          ) : (
                            <button className="boton peque" onClick={() => hacer(acciones.elegirPersonaje(p.id))}>Elegir</button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Marco>

          <div className="fila fin">
            {problema && <span className="aviso">{problema}</span>}
            {soyAnfitrion ? (
              <button className="boton primario grande" disabled={!!problema} onClick={() => hacer(acciones.empezar())} data-testid="empezar">
                Empezar
              </button>
            ) : (
              <span className="tenue">Esperando a que el anfitrión empiece…</span>
            )}
          </div>
          <p className="tenue" style={{ fontSize: 15 }}>
            Consejo: usad auriculares. Así el micrófono solo recoge vuestra voz y el montaje queda limpio.
          </p>
        </div>
      </div>
      {toast}
    </>
  );
}
