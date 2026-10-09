// Crea el entorno de Python (.venv) e instala el motor de Dub Packs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PYTHON_VENV, RAIZ } from './comun.mjs';

const ejecutar = (cmd, args) => {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: RAIZ });
  if (r.status !== 0) {
    console.error(`\nFalló: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
};

const base = process.env.DUBGAME_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
if (!fs.existsSync(PYTHON_VENV)) ejecutar(base, ['-m', 'venv', '.venv']);
ejecutar(PYTHON_VENV, ['-m', 'pip', 'install', '--upgrade', 'pip']);
ejecutar(PYTHON_VENV, ['-m', 'pip', 'install', '-r', path.join('engine', 'requirements.txt')]);
if (process.argv.includes('--dev')) {
  ejecutar(PYTHON_VENV, ['-m', 'pip', 'install', '-r', path.join('engine', 'requirements-dev.txt')]);
}
console.log('\nMotor instalado. Los modelos se descargan solos la primera vez que se usan');
console.log('(o por adelantado con: npm run pack -- modelos).');
