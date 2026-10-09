// Lanza el motor de Dub Packs (Python) con los argumentos dados.
//   node scripts/motor.mjs crear --receta toy-story-eres-un-juguete
//   node scripts/motor.mjs preparar-recetas
//   node scripts/motor.mjs prueba            (genera y evalúa los packs de prueba)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { RAIZ, python } from './comun.mjs';

let [orden, ...resto] = process.argv.slice(2);
// "npm run pack -- recetas" llega como: crear recetas
if (orden === 'crear' && ['recetas', 'modelos', 'preparar-recetas'].includes(resto[0])) orden = resto.shift();
const args = orden === 'prueba'
  ? ['-m', 'dubengine.prueba.generar', '--salida', path.join(RAIZ, 'packs'), ...resto]
  : ['-m', 'dubengine', orden ?? '--help', ...resto];
if (orden && orden !== 'prueba' && ['crear', 'preparar-recetas'].includes(orden) && !resto.includes('--salida')) {
  args.push('--salida', path.join(RAIZ, 'packs'));
}
const r = spawnSync(python(), args, {
  stdio: 'inherit',
  env: { ...process.env, PYTHONPATH: path.join(RAIZ, 'engine') },
});
if (r.error) {
  console.error(`No se pudo ejecutar Python (${python()}). Ejecuta antes: npm run motor:instalar`);
  process.exit(1);
}
process.exit(r.status ?? 1);
