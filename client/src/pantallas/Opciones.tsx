import { useEffect, useRef, useState } from 'react';
import { api, guardarNombre, nombreGuardado } from '../conexion';
import { Microfono, type Reproduccion, cargarAudioPack, contexto, crearBuffer, despertar, latenciaSalida, reproducir, salida } from '../audio/motor';
import { normalizarVoz } from '../audio/dsp';
import { Encabezado, Marco } from '../ui/componentes';
import { Calibracion } from '../ui/Calibracion';
import { ControlVolumen } from '../ui/ControlVolumen';

export function Opciones({ volver }: { volver: () => void }) {
  const [nombre, setNombre] = useState(nombreGuardado());
  const [mic, setMic] = useState<Microfono | null>(null);
  const [nivel, setNivel] = useState(0);
  const [error, setError] = useState('');
  const [estado, setEstado] = useState<'libre' | 'grabando'>('libre');
  const raf = useRef(0);
  const muestra = useRef<Reproduccion | null>(null);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    mic?.cerrar();
  }, [mic]);
  useEffect(() => () => muestra.current?.parar(), []);

  // Unos segundos de una escena (voces y música) para oír cómo queda el volumen
  const probarVolumen = async () => {
    muestra.current?.parar();
    setError('');
    try {
      await despertar();
      const packs = await api.packs();
      const pack = packs.find((p) => p.id === 'prueba-la-entrevista') ?? packs[0];
      if (!pack) throw new Error('No hay ningún pack instalado para probar el sonido');
      const audio = await cargarAudioPack(pack.id);
      const desde = Math.min(2, Math.max(0, audio.voces.duration - 4));
      muestra.current = await reproducir({
        desde,
        hasta: desde + 4,
        pistas: [{ buffer: audio.fondo, en: 0 }, { buffer: audio.voces, en: 0 }],
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const probar = async () => {
    setError('');
    try {
      const m = mic ?? (await Microfono.abrir());
      setMic(m);
      const bucle = () => {
        setNivel(m.nivel);
        raf.current = requestAnimationFrame(bucle);
      };
      bucle();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const grabarPrueba = async () => {
    if (!mic) return;
    setEstado('grabando');
    const ctx = contexto();
    const ini = ctx.currentTime;
    await new Promise((r) => setTimeout(r, 3000));
    const datos = mic.extraer(ini, ctx.currentTime);
    setEstado('libre');
    const n = normalizarVoz(datos, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = crearBuffer([n.datos], ctx.sampleRate);
    src.connect(salida());
    src.start();
  };

  return (
    <>
      <Encabezado titulo="Opciones" onVolver={volver} />
      <div className="estrecho pila">
        <Marco titulo="Jugador">
          <div className="campo">
            <label htmlFor="nombre-op">Nombre por defecto</label>
            <input id="nombre-op" type="text" maxLength={24} value={nombre} onChange={(e) => { setNombre(e.target.value); guardarNombre(e.target.value); }} />
          </div>
        </Marco>
        <Marco titulo="Sonido">
          <p className="tenue" style={{ marginTop: 0 }}>
            Volumen de los vídeos y del resto de sonidos del juego en este dispositivo. Si se oye flojo puedes subirlo hasta el 200 % (si la escena ya suena fuerte, se limita para que no sature). No cambia lo que grabas ni lo que descargas. Durante la grabación también puedes usar las teclas <kbd>+</kbd> y <kbd>−</kbd>.
          </p>
          <div className="fila" style={{ gap: 16 }}>
            <ControlVolumen etiqueta="Volumen" />
            <button className="boton peque" onClick={probarVolumen} data-testid="probar-volumen">▶ Probar</button>
          </div>
        </Marco>
        <Marco titulo="Micrófono">
          <p className="tenue" style={{ marginTop: 0 }}>Usa auriculares para que el micrófono no recoja el sonido del vídeo.</p>
          <div className="fila">
            <button className="boton" onClick={probar}>{mic ? 'Micrófono activo' : 'Probar micrófono'}</button>
            <div className="vumetro"><div style={{ width: `${Math.min(100, nivel * 140)}%` }} /></div>
          </div>
          {mic && (
            <div className="fila mt">
              <button className="boton" disabled={estado === 'grabando'} onClick={grabarPrueba}>
                {estado === 'grabando' ? 'Grabando 3 s…' : 'Grabar y escuchar'}
              </button>
              <span className="tenue">Latencia de salida: {(latenciaSalida(contexto()) * 1000).toFixed(0)} ms</span>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </Marco>
        <Marco titulo="Sincronía">
          <p className="tenue" style={{ marginTop: 0 }}>
            Si usas auriculares Bluetooth, el sonido te llega con retraso y el vídeo y los subtítulos parecen adelantados. Mídelo aquí una vez.
          </p>
          <Calibracion />
        </Marco>
      </div>
    </>
  );
}
