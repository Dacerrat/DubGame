import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
export const PYTHON_VENV = path.join(RAIZ, '.venv', WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');

export function python() {
  if (process.env.DUBGAME_PYTHON) return process.env.DUBGAME_PYTHON;
  return fs.existsSync(PYTHON_VENV) ? PYTHON_VENV : WIN ? 'python' : 'python3';
}
