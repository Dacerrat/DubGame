import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR_PACKS = path.resolve(process.env.DUBGAME_PACKS ?? path.join(RAIZ, 'packs'));
export const DIR_DATOS = path.resolve(process.env.DUBGAME_DATOS ?? path.join(RAIZ, 'data'));
export const DIR_RECETAS = path.join(RAIZ, 'engine', 'recetas');
export const DIR_CLIENTE = path.join(RAIZ, 'dist');

export function python(): string {
  if (process.env.DUBGAME_PYTHON) return process.env.DUBGAME_PYTHON;
  const venv = process.platform === 'win32'
    ? path.join(RAIZ, '.venv', 'Scripts', 'python.exe')
    : path.join(RAIZ, '.venv', 'bin', 'python');
  if (fs.existsSync(venv)) return venv;
  return process.platform === 'win32' ? 'python' : 'python3';
}

/** Evita rutas con "..": solo ids sencillos. */
export function idSeguro(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,80}$/.test(id);
}
