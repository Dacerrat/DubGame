import { expect, test, type Browser, type Page } from '@playwright/test';

async function jugador(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  return page;
}

async function crearSala(page: Page, nombre: string): Promise<string> {
  await page.goto('/');
  await page.getByTestId('menu-crear').click();
  await page.getByTestId('campo-nombre').fill(nombre);
  await page.getByTestId('entrar').click();
  const codigo = (await page.getByTestId('codigo-sala').textContent())!.trim();
  expect(codigo).toMatch(/^[A-Z]{4}$/);
  return codigo;
}

async function unirse(page: Page, codigo: string, nombre: string) {
  await page.goto(`/?sala=${codigo}`);
  await page.getByTestId('campo-nombre').fill(nombre);
  await page.getByTestId('entrar').click();
  await expect(page.getByTestId('codigo-sala')).toHaveText(codigo);
}

/** Control de volumen de la cabina: cambia al momento lo que se oye y se recuerda. */
async function comprobarVolumen(page: Page) {
  const control = page.getByTestId('control-volumen');
  await expect(control).toBeVisible();
  const cifra = control.getByTestId('volumen-porcentaje');
  await expect(cifra).toHaveText('100 %');
  const deslizador = control.getByRole('slider', { name: 'Volumen' });
  await deslizador.focus();
  for (let i = 0; i < 10; i++) await deslizador.press('ArrowRight'); // pasos de 5 %
  await expect(cifra).toHaveText('150 %');
  await control.hover();
  await page.mouse.wheel(0, 100); // rueda hacia abajo: −5 %
  await expect(cifra).toHaveText('145 %');
  // Atajos de teclado de la cabina
  await page.keyboard.press('+');
  await expect(cifra).toHaveText('155 %');
  await page.keyboard.press('-');
  await expect(cifra).toHaveText('145 %');
  expect(await page.evaluate(() => localStorage.getItem('dubgame.volumen'))).toBe('1.45');
  await page.waitForFunction(() => {
    const v = (window as unknown as { __dubgameVolumen: { volumen: number; ganancia: number | null } }).__dubgameVolumen;
    return v.volumen === 1.45 && v.ganancia !== null && Math.abs(v.ganancia - 1.45) < 0.01;
  });
}

/** Graba todas las líneas que le toquen al jugador. */
async function doblar(page: Page, alEmpezar?: (page: Page) => Promise<void>) {
  await page.getByTestId('activar-micro').click();
  await alEmpezar?.(page);
  for (;;) {
    const contador = page.getByTestId('contador-lineas');
    await expect(contador).toBeVisible();
    const texto = (await contador.textContent()) ?? '';
    const [, actual, total] = texto.match(/(\d+) \/ (\d+)/)!.map(Number);
    await expect(page.getByTestId('grabar')).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId('guia-onda')).toBeVisible();
    await page.getByTestId('grabar').click();
    await expect(page.getByTestId('siguiente')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('siguiente').click();
    if (actual === total) break;
    await expect(contador).toHaveText(`Línea ${actual + 1} / ${total}`, { timeout: 15_000 });
  }
}

/** Analiza los montajes generados en el navegador. */
async function analizarMontajes(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as { __dubgameMontajes?: unknown }).__dubgameMontajes, null, { timeout: 60_000 });
  return page.evaluate(() => {
    const m = (window as unknown as { __dubgameMontajes: Map<string, AudioBuffer> }).__dubgameMontajes;
    return [...m.entries()].map(([version, b]) => {
      const d = b.getChannelData(0);
      let s = 0, pico = 0;
      for (let i = 0; i < d.length; i++) {
        s += d[i] * d[i];
        pico = Math.max(pico, Math.abs(d[i]));
      }
      return { version, duracion: b.duration, rms: Math.sqrt(s / d.length), pico };
    });
  });
}

test('modo un personaje por jugador: partida completa hasta el montaje', async ({ browser }) => {
  const ana = await jugador(browser);
  const luis = await jugador(browser);
  const codigo = await crearSala(ana, 'Ana');
  await unirse(luis, codigo, 'Luis');
  await expect(ana.getByTestId('lista-jugadores').locator('li')).toHaveCount(2);

  await ana.getByTestId('elegir-pack').click();
  // Con 2 jugadores solo se ofrecen packs de 2 personajes
  await expect(ana.getByTestId('pack-prueba-la-entrevista')).toBeVisible();
  await expect(ana.getByTestId('pack-prueba-el-atraco')).toHaveCount(0);
  await ana.getByTestId('pack-prueba-la-entrevista').click();
  await expect(ana.getByTestId('pack-elegido')).toHaveText('La entrevista');
  await expect(luis.getByTestId('pack-elegido')).toHaveText('La entrevista');
  await ana.getByTestId('empezar').click();

  // Cada uno tiene un personaje distinto
  const pa = await ana.getByTestId('mi-personaje').textContent();
  const pl = await luis.getByTestId('mi-personaje').textContent();
  expect(new Set([pa, pl]).size).toBe(2);

  await Promise.all([doblar(ana, comprobarVolumen), doblar(luis)]);

  await expect(ana.getByTestId('ver-doblaje')).toBeVisible({ timeout: 60_000 });
  const montajes = await analizarMontajes(ana);
  expect(montajes).toHaveLength(1);
  expect(montajes[0].duracion).toBeGreaterThan(50);
  expect(montajes[0].rms).toBeGreaterThan(0.01);
  expect(montajes[0].pico).toBeLessThanOrEqual(0.9);
  await ana.screenshot({ path: 'test-results/montaje-personajes.png' });

  await ana.getByTestId('ver-doblaje').click();
  await expect(luis.locator('.rec')).toHaveText('Doblaje completo', { timeout: 5_000 });
  await expect(ana.locator('.rec')).toHaveText('Doblaje completo');
});

test('modo en solitario: cada uno dobla la escena entera y se vota', async ({ browser }) => {
  const ana = await jugador(browser);
  const luis = await jugador(browser);
  const codigo = await crearSala(ana, 'Ana');
  await unirse(luis, codigo, 'Luis');

  await ana.getByTestId('selector-modo').getByLabel('Siguiente').click();
  await ana.getByTestId('selector-original').getByLabel('Siguiente').click();
  await ana.getByTestId('elegir-pack').click();
  await ana.getByTestId('pack-prueba-el-narrador').click();
  await ana.getByTestId('empezar').click();

  await expect(ana.getByTestId('mi-personaje')).toHaveText('Narrador');
  await expect(luis.getByTestId('mi-personaje')).toHaveText('Narrador');
  await Promise.all([doblar(ana), doblar(luis)]);

  const montajes = await analizarMontajes(luis);
  expect(montajes).toHaveLength(2);
  for (const m of montajes) expect(m.rms).toBeGreaterThan(0.01);

  await ana.getByTestId('empezar-votacion').click();
  await ana.getByTestId('votar-Luis').click();
  await luis.getByTestId('votar-Ana').click();
  await expect(ana.getByTestId('marcador')).toContainText('Luis');
  await expect(ana.getByTestId('marcador').locator('.puesto')).toHaveCount(2);
  await ana.screenshot({ path: 'test-results/resultados-solitario.png' });

  await ana.getByTestId('nueva-ronda').click();
  await expect(luis.getByTestId('codigo-sala')).toHaveText(codigo);
});
