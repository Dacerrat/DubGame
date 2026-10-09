// Lanza el motor de Python (dubengine) y sigue su progreso.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { TrabajoCreador } from '../shared/tipos';
import { DIR_DATOS, DIR_PACKS, RAIZ, python } from './rutas';

export interface PeticionCreador {
  url?: string;
  video?: string; // ruta local a un archivo subido
  receta?: string;
  titulo?: string;
  tipo?: string;
  idioma?: string;
  hablantes?: number;
  modelo?: string;
  separacion?: string;
  inicio?: string;
  fin?: string;
  forzar?: boolean;
}

export class Creador extends EventEmitter {
  trabajos = new Map<string, TrabajoCreador>();

  lanzar(pet: PeticionCreador): TrabajoCreador {
    const id = crypto.randomBytes(5).toString('hex');
    const trabajo: TrabajoCreador = {
      id, estado: 'en-curso', fase: 'inicio', mensaje: 'Arrancando el motor…', fraccion: null, registro: [],
    };
    this.trabajos.set(id, trabajo);

    const args = ['-m', 'dubengine', 'crear', '--json', '--salida', DIR_PACKS];
    const opc: [keyof PeticionCreador, string][] = [
      ['url', '--url'], ['video', '--video'], ['receta', '--receta'], ['titulo', '--titulo'], ['tipo', '--tipo'],
      ['idioma', '--idioma'], ['modelo', '--modelo'], ['separacion', '--separacion'], ['inicio', '--inicio'], ['fin', '--fin'],
    ];
    for (const [k, flag] of opc) {
      const v = pet[k];
      if (typeof v === 'string' && v.trim()) args.push(flag, v.trim());
    }
    if (pet.hablantes && pet.hablantes > 0) args.push('--hablantes', String(pet.hablantes));
    if (pet.forzar) args.push('--forzar');

    const proc = spawn(python(), args, {
      cwd: RAIZ,
      env: { ...process.env, PYTHONPATH: path.join(RAIZ, 'engine'), PYTHONUNBUFFERED: '1' },
    });
    let resto = '';
    const actualizar = () => this.emit('progreso', { ...trabajo });
    proc.stdout.on('data', (b: Buffer) => {
      resto += b.toString('utf8');
      const lineas = resto.split('\n');
      resto = lineas.pop() ?? '';
      for (const l of lineas) {
        if (!l.trim()) continue;
        try {
          const ev = JSON.parse(l);
          if (ev.tipo === 'progreso') {
            trabajo.fase = ev.fase;
            trabajo.mensaje = ev.mensaje;
            trabajo.fraccion = ev.fraccion;
          } else if (ev.tipo === 'resultado') {
            trabajo.packId = ev.id;
          } else if (ev.tipo === 'error') {
            trabajo.error = ev.mensaje;
          }
        } catch {
          trabajo.registro.push(l);
        }
        actualizar();
      }
    });
    proc.stderr.on('data', (b: Buffer) => {
      trabajo.registro.push(...b.toString('utf8').split('\n').filter(Boolean));
      trabajo.registro = trabajo.registro.slice(-200);
    });
    proc.on('error', (e) => {
      trabajo.estado = 'error';
      trabajo.error = `No se pudo ejecutar Python (${python()}): ${e.message}. ¿Has ejecutado "npm run motor:instalar"?`;
      actualizar();
    });
    proc.on('close', (code) => {
      if (pet.video?.startsWith(path.join(DIR_DATOS, 'subidas'))) fs.rm(pet.video, { force: true }, () => {});
      if (trabajo.estado === 'error') return;
      if (code === 0 && trabajo.packId) {
        trabajo.estado = 'terminado';
        trabajo.mensaje = 'Pack creado';
        trabajo.fraccion = 1;
      } else {
        trabajo.estado = 'error';
        trabajo.error ??= `El motor terminó con código ${code}. ${trabajo.registro.slice(-3).join(' ')}`;
      }
      actualizar();
    });
    return trabajo;
  }
}
