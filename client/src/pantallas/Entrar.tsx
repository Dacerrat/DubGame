import { useState } from 'react';
import { acciones, nombreGuardado } from '../conexion';
import { Encabezado, Marco } from '../ui/componentes';

export function Entrar({ modo, codigoInicial, volver }: { modo: 'crear' | 'unirse'; codigoInicial?: string; volver: () => void }) {
  const [nombre, setNombre] = useState(nombreGuardado());
  const [codigo, setCodigo] = useState(codigoInicial ?? '');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setOcupado(true);
    try {
      if (modo === 'crear') await acciones.crearSala(nombre);
      else await acciones.unirse(codigo, nombre);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <Encabezado titulo={modo === 'crear' ? 'Crear partida' : 'Unirse a partida'} onVolver={volver} />
      <form className="estrecho" onSubmit={enviar}>
        <Marco>
          {modo === 'unirse' && (
            <div className="campo">
              <label htmlFor="codigo">Código de sala</label>
              <input
                id="codigo"
                className="codigo-input"
                type="text"
                maxLength={4}
                value={codigo}
                autoFocus={!codigo}
                autoComplete="off"
                onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                data-testid="campo-codigo"
              />
            </div>
          )}
          <div className="campo">
            <label htmlFor="nombre">Tu nombre</label>
            <input
              id="nombre"
              type="text"
              maxLength={24}
              value={nombre}
              autoFocus={modo === 'crear' || !!codigo}
              onChange={(e) => setNombre(e.target.value)}
              data-testid="campo-nombre"
            />
          </div>
          {error && <p className="error">{error}</p>}
          <div className="fila fin mt">
            <button
              className="boton primario grande"
              disabled={ocupado || !nombre.trim() || (modo === 'unirse' && codigo.length !== 4)}
              data-testid="entrar"
            >
              {modo === 'crear' ? 'Crear sala' : 'Entrar'}
            </button>
          </div>
        </Marco>
      </form>
    </>
  );
}
