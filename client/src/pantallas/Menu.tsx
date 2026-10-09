import type { Pantalla } from '../App';
import { Opcion, useTeclas } from '../ui/componentes';
import { Separador } from '../ui/ornamentos';

export function Menu({ ir, local }: { ir: (p: Pantalla) => void; local: boolean }) {
  useTeclas({ c: () => ir({ id: 'crear' }), u: () => ir({ id: 'unirse' }) });
  return (
    <>
      <header className="titulo-juego">
        <h1>DUBGAME</h1>
        <Separador ancho={460} />
        <div className="sub">DOBLAJE · EN · CASTELLANO</div>
      </header>
      <nav className="menu">
        <Opcion onClick={() => ir({ id: 'crear' })} autoFocus testid="menu-crear">Crear partida</Opcion>
        <Opcion onClick={() => ir({ id: 'unirse' })} testid="menu-unirse">Unirse a partida</Opcion>
        <Opcion onClick={() => ir({ id: 'packs' })} testid="menu-packs">Dub Packs</Opcion>
        <Opcion onClick={() => ir({ id: 'crearPack' })} disabled={!local} testid="menu-crear-pack">Crear pack</Opcion>
        <Opcion onClick={() => ir({ id: 'opciones' })}>Opciones</Opcion>
      </nav>
      {!local && (
        <p className="tenue centrado mt" style={{ maxWidth: 420 }}>
          Crear y editar packs solo se puede desde el ordenador que hace de servidor.
        </p>
      )}
    </>
  );
}
