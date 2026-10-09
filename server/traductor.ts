// Traducción opcional de las líneas de un pack al castellano de España con Claude.
// Solo se activa si hay credenciales de la API de Anthropic (ANTHROPIC_API_KEY).
import Anthropic from '@anthropic-ai/sdk';
import type { Pack } from '../shared/tipos';

export function traduccionDisponible(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const SISTEMA = `Eres un adaptador de doblaje profesional de España.
Traduces diálogos de películas, series y videojuegos al castellano de España (no latino):
usa "vosotros", expresiones naturales de España y un registro coloquial cuando el original lo sea.
Cada línea se va a doblar encima de la boca del personaje, así que la traducción debe durar
más o menos lo mismo al decirla en voz alta que el original (mira la duración en segundos).
Conserva nombres propios, el tono y los chistes (adáptalos si no funcionan en castellano).
Si una línea es un grito, un gruñido o no tiene texto, devuelve algo breve que se pueda decir.`;

const ESQUEMA = {
  type: 'object',
  properties: {
    lineas: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, texto: { type: 'string' } },
        required: ['id', 'texto'],
        additionalProperties: false,
      },
    },
  },
  required: ['lineas'],
  additionalProperties: false,
};

/** Devuelve lineaId -> texto en castellano. */
export async function traducirPack(pack: Pack, soloVacias: boolean): Promise<Record<string, string>> {
  const objetivo = pack.lineas.filter((l) => !soloVacias || !l.texto.trim());
  if (objetivo.length === 0) return {};
  const nombre = (id: string) => pack.personajes.find((p) => p.id === id)?.nombre ?? id;
  const entrada = objetivo.map((l) => ({
    id: l.id,
    personaje: nombre(l.personaje),
    segundos: Math.round((l.fin - l.inicio) * 10) / 10,
    original: l.textoOriginal || l.texto,
  }));

  const client = new Anthropic();
  const respuesta = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
    system: SISTEMA,
    messages: [{
      role: 'user',
      content: `Escena: "${pack.titulo}" (${pack.obra}). Idioma original: ${pack.idiomaOriginal}.\n` +
        `Traduce cada línea y devuelve el mismo id:\n${JSON.stringify(entrada, null, 1)}`,
    }],
  });
  if (respuesta.stop_reason === 'refusal') throw new Error('Claude no ha podido traducir esta escena');
  if (respuesta.stop_reason === 'max_tokens') throw new Error('La escena es demasiado larga para traducirla de una vez');
  const texto = respuesta.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const datos = JSON.parse(texto) as { lineas: { id: string; texto: string }[] };
  const validos = new Set(objetivo.map((l) => l.id));
  return Object.fromEntries(datos.lineas.filter((l) => validos.has(l.id) && l.texto.trim()).map((l) => [l.id, l.texto.trim()]));
}
