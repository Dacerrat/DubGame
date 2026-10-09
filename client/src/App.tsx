import { useEffect, useState } from 'react';
import { acciones, api, useConexion } from './conexion';
import { Fondo } from './ui/ornamentos';
import { Menu } from './pantallas/Menu';
import { Entrar } from './pantallas/Entrar';
import { Packs } from './pantallas/Packs';
import { Sala } from './pantallas/Sala';
import { Grabacion } from './pantallas/Grabacion';
import { Montaje } from './pantallas/Montaje';
import { CrearPack } from './pantallas/CrearPack';
import { Editor } from './pantallas/Editor';
import { Opciones } from './pantallas/Opciones';

export type Pantalla =
  | { id: 'menu' }
  | { id: 'crear' }
  | { id: 'unirse'; codigo?: string }
  | { id: 'packs' }
  | { id: 'crearPack'; receta?: string }
  | { id: 'editor'; packId: string }
  | { id: 'opciones' };

export function App() {
  const { sesion, sala, conectado, expulsado } = useConexion();
  const codigoUrl = new URLSearchParams(location.search).get('sala') ?? undefined;
  const [pantalla, setPantalla] = useState<Pantalla>(codigoUrl ? { id: 'unirse', codigo: codigoUrl } : { id: 'menu' });
  const [local, setLocal] = useState(false);

  useEffect(() => {
    api.info().then((i) => setLocal(i.local)).catch(() => {});
  }, []);

  useEffect(() => {
    if (expulsado) {
      alert('El anfitrión te ha sacado de la sala.');
      acciones.olvidarExpulsion();
      setPantalla({ id: 'menu' });
    }
  }, [expulsado]);

  let contenido;
  if (sesion && sala) {
    if (sala.fase === 'lobby') contenido = <Sala sala={sala} yo={sesion.jugadorId} />;
    else if (sala.fase === 'grabando') contenido = <Grabacion sala={sala} sesion={sesion} />;
    else contenido = <Montaje sala={sala} yo={sesion.jugadorId} />;
  } else if (sesion && !sala) {
    contenido = <div className="cargando">ENTRANDO EN LA SALA…</div>;
  } else {
    const ir = setPantalla;
    switch (pantalla.id) {
      case 'menu':
        contenido = <Menu ir={ir} local={local} />;
        break;
      case 'crear':
      case 'unirse':
        contenido = <Entrar modo={pantalla.id} codigoInicial={pantalla.id === 'unirse' ? pantalla.codigo : undefined} volver={() => ir({ id: 'menu' })} />;
        break;
      case 'packs':
        contenido = <Packs volver={() => ir({ id: 'menu' })} local={local} ir={ir} />;
        break;
      case 'crearPack':
        contenido = <CrearPack volver={() => ir({ id: 'packs' })} receta={pantalla.receta} ir={ir} />;
        break;
      case 'editor':
        contenido = <Editor packId={pantalla.packId} volver={() => ir({ id: 'packs' })} />;
        break;
      case 'opciones':
        contenido = <Opciones volver={() => ir({ id: 'menu' })} />;
        break;
    }
  }

  return (
    <>
      <Fondo />
      <div className="app">
        {!conectado && <div className="aviso centrado" style={{ marginBottom: 8 }}>Conectando con el servidor…</div>}
        {contenido}
      </div>
    </>
  );
}
