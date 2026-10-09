import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { Pack, PackResumen, Receta, RecetaResumen } from '../shared/tipos';
import { validarPack } from '../shared/reglas';
import { DIR_PACKS, DIR_RECETAS, idSeguro } from './rutas';

const ARCHIVOS_PACK = ['pack.json', 'video.mp4', 'fondo.m4a', 'voces.m4a', 'portada.jpg'];

export function rutaPack(id: string): string {
  if (!idSeguro(id)) throw new Error('id de pack no válido');
  return path.join(DIR_PACKS, id);
}

export function leerPack(id: string): Pack | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(rutaPack(id), 'pack.json'), 'utf8')) as Pack;
  } catch {
    return null;
  }
}

function tamanoCarpeta(dir: string): number {
  let total = 0;
  for (const f of fs.readdirSync(dir)) {
    const st = fs.statSync(path.join(dir, f));
    if (st.isFile()) total += st.size;
  }
  return total;
}

export function resumir(p: Pack, dir: string): PackResumen {
  return {
    id: p.id,
    titulo: p.titulo,
    obra: p.obra,
    tipo: p.tipo,
    autor: p.autor,
    duracion: p.duracion,
    estado: p.estado,
    personajes: p.personajes,
    nLineas: p.lineas.length,
    lineasPorPersonaje: p.personajes.map((q) => p.lineas.filter((l) => l.personaje === q.id).length),
    tamano: tamanoCarpeta(dir),
    portada: fs.existsSync(path.join(dir, 'portada.jpg')),
    video: fs.existsSync(path.join(dir, 'video.mp4')),
  };
}

export function listarPacks(): PackResumen[] {
  if (!fs.existsSync(DIR_PACKS)) return [];
  const out: PackResumen[] = [];
  for (const id of fs.readdirSync(DIR_PACKS)) {
    if (!idSeguro(id)) continue;
    const dir = path.join(DIR_PACKS, id);
    const p = leerPack(id);
    if (p && fs.existsSync(path.join(dir, 'fondo.m4a'))) out.push(resumir(p, dir));
  }
  return out.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
}

export function guardarPack(p: Pack): void {
  const error = validarPack(p);
  if (error) throw new Error(error);
  const dir = rutaPack(p.id);
  if (!fs.existsSync(dir)) throw new Error('El pack no existe');
  const lineas = [...p.lineas].sort((a, b) => a.inicio - b.inicio);
  const sinRevisar = lineas.some((l) => (l.confianza ?? 1) < 0.45);
  const final: Pack = { ...p, lineas, estado: sinRevisar ? 'revisar' : 'listo' };
  const tmp = path.join(dir, 'pack.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(final, null, 2) + '\n');
  fs.renameSync(tmp, path.join(dir, 'pack.json'));
}

export function borrarPack(id: string): void {
  fs.rmSync(rutaPack(id), { recursive: true, force: true });
}

export function exportarPack(id: string): Buffer {
  const dir = rutaPack(id);
  const zip = new AdmZip();
  for (const f of ARCHIVOS_PACK) {
    const ruta = path.join(dir, f);
    if (fs.existsSync(ruta)) zip.addLocalFile(ruta, id);
  }
  return zip.toBuffer();
}

/** Importa un .dubpack (zip con una carpeta <id>/ o los archivos sueltos). */
export function importarPack(datos: Buffer, sobrescribir = false): string {
  const zip = new AdmZip(datos);
  const entradas = zip.getEntries().filter((e) => !e.isDirectory);
  const json = entradas.find((e) => path.basename(e.entryName) === 'pack.json');
  if (!json) throw new Error('El archivo no contiene pack.json');
  const pack = JSON.parse(json.getData().toString('utf8')) as Pack;
  const error = validarPack(pack);
  if (error) throw new Error(`Pack no válido: ${error}`);
  const dir = rutaPack(pack.id);
  if (fs.existsSync(dir) && !sobrescribir) throw new Error(`Ya existe un pack con id "${pack.id}"`);
  const tmp = `${dir}.importando`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const base = path.dirname(json.entryName);
  for (const e of entradas) {
    const nombre = path.basename(e.entryName);
    if (path.dirname(e.entryName) !== base || !ARCHIVOS_PACK.includes(nombre)) continue;
    fs.writeFileSync(path.join(tmp, nombre), e.getData());
  }
  if (!fs.existsSync(path.join(tmp, 'fondo.m4a'))) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error('Al pack le falta fondo.m4a');
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  return pack.id;
}

export function listarRecetas(): RecetaResumen[] {
  if (!fs.existsSync(DIR_RECETAS)) return [];
  return fs
    .readdirSync(DIR_RECETAS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR_RECETAS, f), 'utf8')) as Receta)
    .map((r) => ({
      id: r.id,
      titulo: r.titulo,
      obra: r.obra,
      tipo: r.tipo,
      personajes: r.personajes.map((p) => p.nombre),
      nLineas: r.guion.length,
      preparada: fs.existsSync(path.join(DIR_PACKS, r.id, 'pack.json')),
    }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
}
