import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import multer from 'multer';
import { Server, type Socket } from 'socket.io';
import type { ConfigSala, RespuestaSala } from '../shared/tipos';
import { Creador } from './creador';
import {
  borrarPack, exportarPack, guardarPack, importarPack, leerPack, listarPacks, listarRecetas, rutaPack,
} from './packs';
import { DIR_CLIENTE, DIR_DATOS, DIR_PACKS, idSeguro } from './rutas';
import { ErrorSala, GestorSalas, type Sala } from './salas';

const PUERTO = Number(process.env.PORT ?? 3000);
const USAR_HTTPS = process.env.HTTPS === '1';
const DIR_SALAS = path.join(DIR_DATOS, 'salas');
fs.mkdirSync(DIR_PACKS, { recursive: true });
fs.mkdirSync(path.join(DIR_DATOS, 'subidas'), { recursive: true });

const gestor = new GestorSalas(leerPack);
const creador = new Creador();
const app = express();
app.disable('x-powered-by');

function ffmpegDisponible(): string | null {
  const candidato = process.env.DUBGAME_FFMPEG ?? 'ffmpeg';
  const r = spawnSync(candidato, ['-version'], { stdio: 'ignore' });
  return r.status === 0 ? candidato : null;
}
const FFMPEG = ffmpegDisponible();

function esLocal(req: express.Request): boolean {
  if (process.env.DUBGAME_EDITOR_REMOTO === '1') return true;
  const ip = req.socket.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function soloLocal(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (esLocal(req)) return next();
  res.status(403).json({ error: 'Esta función solo está disponible en el ordenador que hace de servidor' });
}

const enviarError = (res: express.Response, e: unknown, codigo = 400) =>
  res.status(codigo).json({ error: e instanceof Error ? e.message : String(e) });

// ---------- Packs ----------
app.use('/packs', express.static(DIR_PACKS, { dotfiles: 'deny', fallthrough: false, maxAge: '1h' }));

app.get('/api/info', (req, res) => {
  res.json({ local: esLocal(req), ffmpeg: !!FFMPEG, hora: Date.now() });
});
app.get('/api/hora', (_req, res) => res.json({ hora: Date.now() }));

app.get('/api/packs', (_req, res) => res.json(listarPacks()));
app.get('/api/packs/:id', (req, res) => {
  const p = idSeguro(req.params.id) ? leerPack(req.params.id) : null;
  if (!p) return res.status(404).json({ error: 'No existe ese pack' });
  res.json(p);
});
app.put('/api/packs/:id', soloLocal, express.json({ limit: '5mb' }), (req, res) => {
  try {
    const id = String(req.params.id);
    if (req.body?.id !== id) throw new Error('El id no coincide');
    guardarPack(req.body);
    res.json({ ok: true, pack: leerPack(id) });
  } catch (e) {
    enviarError(res, e);
  }
});
app.delete('/api/packs/:id', soloLocal, (req, res) => {
  try {
    borrarPack(String(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    enviarError(res, e);
  }
});
app.get('/api/packs/:id/exportar', (req, res) => {
  try {
    const datos = exportarPack(req.params.id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.dubpack"`);
    res.send(datos);
  } catch (e) {
    enviarError(res, e, 404);
  }
});
app.post('/api/packs/importar', soloLocal, express.raw({ type: '*/*', limit: '2gb' }), (req, res) => {
  try {
    const id = importarPack(req.body as Buffer, req.query.sobrescribir === '1');
    res.json({ ok: true, id });
  } catch (e) {
    enviarError(res, e);
  }
});

// ---------- Recetas y creador ----------
app.get('/api/recetas', (_req, res) => res.json(listarRecetas()));

const subida = multer({ dest: path.join(DIR_DATOS, 'subidas'), limits: { fileSize: 4 * 1024 ** 3 } });
app.post('/api/creador', soloLocal, subida.single('video'), (req, res) => {
  const b = req.body as Record<string, string>;
  if (!req.file && !b.url && !b.receta) return res.status(400).json({ error: 'Indica un vídeo, una URL o una receta' });
  if (b.receta && !idSeguro(b.receta)) return res.status(400).json({ error: 'Receta no válida' });
  let video: string | undefined;
  if (req.file) {
    const ext = path.extname(req.file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.mp4';
    video = req.file.path + ext;
    fs.renameSync(req.file.path, video);
  }
  const trabajo = creador.lanzar({
    url: b.url, video, receta: b.receta, titulo: b.titulo, tipo: b.tipo, idioma: b.idioma,
    hablantes: b.hablantes ? Number(b.hablantes) : undefined, modelo: b.modelo, separacion: b.separacion,
    inicio: b.inicio, fin: b.fin, forzar: b.forzar === '1',
  });
  res.json(trabajo);
});
app.get('/api/creador/:id', (req, res) => {
  const t = creador.trabajos.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Trabajo no encontrado' });
  res.json(t);
});

// ---------- Tomas ----------
function salaDe(req: express.Request, res: express.Response): Sala | null {
  const sala = gestor.obtener(String(req.params.codigo));
  if (!sala) {
    res.status(404).json({ error: 'La sala no existe' });
    return null;
  }
  return sala;
}

app.put('/api/salas/:codigo/tomas/:ronda/:linea', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
  const sala = salaDe(req, res);
  if (!sala) return;
  const jugador = String(req.header('x-jugador') ?? '');
  if (!sala.autenticar(jugador, req.header('x-token'))) return res.status(403).json({ error: 'No autorizado' });
  const ronda = Number(req.params.ronda);
  const linea = req.params.linea;
  if (!/^[a-z0-9_-]{1,40}$/i.test(linea)) return res.status(400).json({ error: 'Línea no válida' });
  const cuerpo = req.body as Buffer;
  if (!Buffer.isBuffer(cuerpo) || cuerpo.length < 44 || cuerpo.subarray(0, 4).toString() !== 'RIFF') {
    return res.status(400).json({ error: 'La toma debe ser un WAV' });
  }
  if (!sala.registrarToma(jugador, ronda, linea)) return res.status(409).json({ error: 'Esa línea no te toca' });
  const dir = path.join(DIR_SALAS, sala.codigo, `r${ronda}`, jugador);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${linea}.wav`), cuerpo);
  emitirEstado(sala);
  res.json({ ok: true });
});

app.get('/api/salas/:codigo/tomas/:ronda/:jugador/:linea', (req, res) => {
  const sala = salaDe(req, res);
  if (!sala) return;
  const { ronda, jugador, linea } = req.params;
  if (!/^\d+$/.test(ronda) || !/^[a-f0-9]+$/.test(jugador) || !/^[a-z0-9_-]{1,40}$/i.test(linea)) {
    return res.status(400).end();
  }
  const ruta = path.join(DIR_SALAS, sala.codigo, `r${ronda}`, jugador, `${linea}.wav`);
  if (!fs.existsSync(ruta)) return res.status(404).end();
  res.sendFile(ruta);
});

// Exportar el montaje a MP4: el cliente manda la mezcla (WAV) y se une al vídeo del pack.
app.post('/api/exportar/:pack', express.raw({ type: '*/*', limit: '300mb' }), (req, res) => {
  if (!FFMPEG) return res.status(501).json({ error: 'ffmpeg no está instalado en el servidor' });
  let dir: string;
  try {
    dir = rutaPack(req.params.pack);
  } catch (e) {
    return enviarError(res, e);
  }
  const video = path.join(dir, 'video.mp4');
  if (!fs.existsSync(video)) return res.status(404).json({ error: 'El pack no tiene vídeo' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dubgame-'));
  const wav = path.join(tmp, 'mezcla.wav');
  const salida = path.join(tmp, 'montaje.mp4');
  fs.writeFileSync(wav, req.body as Buffer);
  const p = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', salida]);
  p.on('close', (code) => {
    if (code !== 0) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return res.status(500).json({ error: 'ffmpeg no pudo generar el vídeo' });
    }
    res.download(salida, `doblaje-${req.params.pack}.mp4`, () => fs.rmSync(tmp, { recursive: true, force: true }));
  });
});

// ---------- Cliente ----------
if (fs.existsSync(DIR_CLIENTE)) {
  app.use(express.static(DIR_CLIENTE, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api|packs|socket\.io).*/, (_req, res) => res.sendFile(path.join(DIR_CLIENTE, 'index.html')));
}

// ---------- Servidor HTTP(S) + Socket.IO ----------
async function crearServidor(): Promise<http.Server | https.Server> {
  if (!USAR_HTTPS) return http.createServer(app);
  const rutaCert = path.join(DIR_DATOS, 'certificado.json');
  let pems: { private: string; cert: string };
  if (fs.existsSync(rutaCert)) {
    pems = JSON.parse(fs.readFileSync(rutaCert, 'utf8'));
  } else {
    const selfsigned = await import('selfsigned');
    pems = await selfsigned.generate([{ name: 'commonName', value: 'dubgame.local' }], { keySize: 2048, notAfterDate: new Date(Date.now() + 3650 * 86400_000) });
    fs.writeFileSync(rutaCert, JSON.stringify({ private: pems.private, cert: pems.cert }));
  }
  return https.createServer({ key: pems.private, cert: pems.cert }, app);
}

const servidor = await crearServidor();
const io = new Server(servidor, { maxHttpBufferSize: 1e6, cors: { origin: true } });

function emitirEstado(sala: Sala) {
  io.to(sala.codigo).emit('sala:estado', sala.estado());
}

creador.on('progreso', (t) => io.to('creador').emit('creador:progreso', t));

const temporizadoresSalida = new Map<string, NodeJS.Timeout>();

type Ack = (r: RespuestaSala) => void;

io.on('connection', (socket: Socket) => {
  const ctx = () => {
    const sala = socket.data.codigo ? gestor.obtener(socket.data.codigo) : undefined;
    const jugadorId = socket.data.jugadorId as string | undefined;
    if (!sala || !jugadorId || !sala.jugador(jugadorId)) throw new ErrorSala('No estás en ninguna sala');
    return { sala, jugadorId };
  };
  const manejar = <T>(evento: string, fn: (datos: T) => RespuestaSala | void) => {
    socket.on(evento, (datos: T, ack?: Ack) => {
      try {
        const r = fn(datos) ?? { ok: true };
        if (typeof ack === 'function') ack(r);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (!(e instanceof ErrorSala)) console.error(`[${evento}]`, e);
        if (typeof ack === 'function') ack({ ok: false, error });
      }
    });
  };
  const entrar = (sala: Sala, jugadorId: string) => {
    socket.data.codigo = sala.codigo;
    socket.data.jugadorId = jugadorId;
    socket.join(sala.codigo);
    const t = temporizadoresSalida.get(jugadorId);
    if (t) clearTimeout(t);
    emitirEstado(sala);
  };

  socket.on('hora', (_: unknown, ack?: (t: number) => void) => typeof ack === 'function' && ack(Date.now()));
  socket.on('creador:suscribir', () => socket.join('creador'));

  manejar<{ nombre: string }>('sala:crear', ({ nombre }) => {
    const sala = gestor.crear();
    const { jugadorId, token } = sala.unir(nombre);
    entrar(sala, jugadorId);
    return { ok: true, codigo: sala.codigo, jugadorId, token };
  });

  manejar<{ codigo: string; nombre?: string; jugadorId?: string; token?: string }>('sala:unirse', (d) => {
    const sala = gestor.obtener(d.codigo ?? '');
    if (!sala) throw new ErrorSala('No existe ninguna sala con ese código');
    if (d.jugadorId && d.token && sala.reconectar(d.jugadorId, d.token)) {
      entrar(sala, d.jugadorId);
      return { ok: true, codigo: sala.codigo, jugadorId: d.jugadorId, token: d.token };
    }
    if (!d.nombre) throw new ErrorSala('Escribe un nombre');
    const { jugadorId, token } = sala.unir(d.nombre);
    entrar(sala, jugadorId);
    return { ok: true, codigo: sala.codigo, jugadorId, token };
  });

  manejar('sala:salir', () => {
    const { sala, jugadorId } = ctx();
    sala.quitar(jugadorId);
    socket.leave(sala.codigo);
    socket.data.codigo = undefined;
    emitirEstado(sala);
  });

  manejar<Partial<ConfigSala>>('sala:config', (cambios) => {
    const { sala, jugadorId } = ctx();
    sala.configurar(jugadorId, cambios);
    emitirEstado(sala);
  });

  manejar<{ personajeId: string | null }>('sala:elegirPersonaje', ({ personajeId }) => {
    const { sala, jugadorId } = ctx();
    sala.elegirPersonaje(jugadorId, personajeId);
    emitirEstado(sala);
  });

  manejar<{ jugadorId: string }>('sala:expulsar', (d) => {
    const { sala, jugadorId } = ctx();
    sala.expulsar(jugadorId, d.jugadorId);
    for (const s of io.sockets.sockets.values()) {
      if (s.data.jugadorId === d.jugadorId) {
        s.emit('sala:expulsado');
        s.leave(sala.codigo);
        s.data.codigo = undefined;
      }
    }
    emitirEstado(sala);
  });

  manejar('sala:empezar', () => {
    const { sala, jugadorId } = ctx();
    sala.empezar(jugadorId);
    // Solo se conservan las tomas de la ronda actual
    const dir = path.join(DIR_SALAS, sala.codigo);
    if (fs.existsSync(dir)) {
      for (const r of fs.readdirSync(dir)) if (r !== `r${sala.ronda}`) fs.rmSync(path.join(dir, r), { recursive: true, force: true });
    }
    emitirEstado(sala);
  });

  manejar('grabacion:terminar', () => {
    const { sala, jugadorId } = ctx();
    sala.terminarGrabacion(jugadorId);
    emitirEstado(sala);
  });

  manejar('grabacion:forzarMontaje', () => {
    const { sala, jugadorId } = ctx();
    sala.forzarMontaje(jugadorId);
    emitirEstado(sala);
  });

  manejar('montaje:listo', () => {
    const { sala, jugadorId } = ctx();
    sala.marcarMontajeListo(jugadorId);
    emitirEstado(sala);
  });

  manejar<{ version: string | null }>('montaje:reproducir', ({ version }) => {
    const { sala, jugadorId } = ctx();
    if (jugadorId !== sala.anfitrion) throw new ErrorSala('Solo el anfitrión controla la reproducción');
    io.to(sala.codigo).emit('montaje:play', { inicioServidor: Date.now() + 1500, version: version ?? null });
  });

  manejar('montaje:parar', () => {
    const { sala, jugadorId } = ctx();
    if (jugadorId !== sala.anfitrion) throw new ErrorSala('Solo el anfitrión controla la reproducción');
    io.to(sala.codigo).emit('montaje:stop');
  });

  manejar('votacion:empezar', () => {
    const { sala, jugadorId } = ctx();
    sala.empezarVotacion(jugadorId);
    emitirEstado(sala);
  });

  manejar<{ por: string }>('votacion:votar', ({ por }) => {
    const { sala, jugadorId } = ctx();
    sala.votar(jugadorId, por);
    emitirEstado(sala);
  });

  manejar('sala:nuevaRonda', () => {
    const { sala, jugadorId } = ctx();
    sala.nuevaRonda(jugadorId);
    emitirEstado(sala);
  });

  socket.on('disconnect', () => {
    const codigo = socket.data.codigo as string | undefined;
    const jugadorId = socket.data.jugadorId as string | undefined;
    const sala = codigo ? gestor.obtener(codigo) : undefined;
    if (!sala || !jugadorId) return;
    // ¿Sigue conectado desde otra pestaña?
    for (const s of io.sockets.sockets.values()) if (s.data.jugadorId === jugadorId && s.id !== socket.id) return;
    sala.desconectar(jugadorId);
    emitirEstado(sala);
    // En la sala de espera, quien no vuelve en 90 s sale de la sala.
    temporizadoresSalida.set(jugadorId, setTimeout(() => {
      temporizadoresSalida.delete(jugadorId);
      const j = sala.jugador(jugadorId);
      if (j && !j.conectado && sala.fase === 'lobby') {
        sala.quitar(jugadorId);
        emitirEstado(sala);
      }
    }, 90_000));
  });
});

setInterval(() => {
  for (const codigo of gestor.limpiar(2 * 3600_000)) {
    fs.rmSync(path.join(DIR_SALAS, codigo), { recursive: true, force: true });
  }
}, 5 * 60_000).unref();

servidor.listen(PUERTO, () => {
  const proto = USAR_HTTPS ? 'https' : 'http';
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `${proto}://${i!.address}:${PUERTO}`);
  console.log(`\n  DubGame en marcha`);
  console.log(`  · En este ordenador: ${proto}://localhost:${PUERTO}`);
  for (const ip of ips) console.log(`  · En tu red:         ${ip}`);
  if (!USAR_HTTPS && ips.length) {
    console.log('\n  Aviso: los móviles solo dejan usar el micrófono con HTTPS. Arranca con HTTPS=1 para jugar desde otros dispositivos.');
  }
  console.log(`  · Packs: ${DIR_PACKS} (${listarPacks().length})\n`);
});
