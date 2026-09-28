import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';

// Acciones de usuario sobre la app, compartidas por el test e2e, las capturas y el video de la demo.

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

/** Pantalla de celular (tamaño de un iPhone 14). */
export const MOBILE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'es-AR',
};

export const TENANT = 'hamburgueseria-test';

/**
 * Un celular. Con `debug` la app muestra las vistas de desarrollo (actividad, simular desconexión,
 * cocina), que la UI pública oculta: el e2e las usa; las capturas y el video, no.
 */
export async function newPhone(
  browser: Browser,
  { debug = false, ...extra }: BrowserContextOptions & { debug?: boolean } = {},
) {
  const context = await browser.newContext({ ...MOBILE, baseURL: BASE_URL, ...extra });
  if (debug) await context.addInitScript(() => sessionStorage.setItem('pedido:debug', '1'));
  const page = await context.newPage();
  return { context, page };
}

/** El host crea el pedido en la primera sucursal abierta y devuelve el código. */
export async function createOrder(page: Page, tenant: string, name: string): Promise<string> {
  await page.goto(`/t/${tenant}`);
  await page.getByPlaceholder('Tu nombre').fill(name);
  await page.getByRole('button', { name: 'Crear pedido grupal' }).click();
  await page.waitForURL(/\/o\/[A-Z0-9]{6}$/);
  await expectConnected(page);
  return page.url().split('/').pop()!;
}

export async function joinOrder(page: Page, tenant: string, code: string, name: string) {
  await page.goto(`/t/${tenant}/o/${code}`);
  await page.getByPlaceholder('¿Cómo te llamás?').fill(name);
  await page.getByRole('button', { name: 'Sumarme al pedido' }).click();
  await expectConnected(page);
}

export async function expectConnected(page: Page) {
  await expect(page.getByTestId('connection')).toHaveText(/Conectado|Sincronizado/, {
    timeout: 10_000,
  });
}

/** Pestañas de la vista mobile. */
export async function goTab(page: Page, tab: 'Menú' | 'Pedido' | 'Actividad') {
  await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
}

/** Toca "+" en el menú: la primera vez agrega la línea, después suma sobre ella. */
export async function tapAdd(page: Page, product: string, times = 1, gapMs = 0) {
  // En mobile el menú está en su pestaña.
  const menuTab = page.getByRole('tab', { name: /^Menú/ });
  if ((await menuTab.isVisible()) && (await menuTab.getAttribute('aria-selected')) !== 'true') {
    await menuTab.click();
  }
  for (let i = 0; i < times; i++) {
    const add = page.getByRole('button', { name: `Agregar ${product}`, exact: true });
    if (await add.isVisible()) await add.click();
    else
      await page
        .getByRole('button', { name: `Sumar ${product}`, exact: true })
        .first()
        .click();
    if (gapMs) await page.waitForTimeout(gapMs);
  }
}

export async function writeNote(page: Page, product: string, note: string) {
  const input = page.getByLabel(`Aclaración para ${product}`).first();
  await input.fill(note);
  await input.blur();
}

/** Espera a que se hayan enviado los cambios agrupados (debounce de 300 ms) y lleguen las confirmaciones. */
export async function settle(page: Page, ms = 900) {
  await page.waitForTimeout(ms);
}

/** Lo que cada pantalla muestra del pedido del grupo, para comparar entre participantes. */
export async function readGroupOrder(page: Page) {
  // Una sola lectura atómica del DOM: con locators por línea, una línea que se va (p. ej. un cambio
  // rechazado que se revierte con animación de salida) podía desaparecer entre encontrarla y
  // leerla, y el locator quedaba esperando hasta el timeout del test.
  const raw = await page.evaluate(() => {
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const parts: Record<string, { total: string; lines: string[] }> = {};
    for (const part of document.querySelectorAll('[data-testid="part"]')) {
      const lines: string[] = [];
      for (const line of part.querySelectorAll('[data-testid="line"]')) {
        const name = text(line.querySelector('[data-testid="line-name"]'));
        const qty = text(line.querySelector('[data-testid="qty"]')).replace('×', '');
        const input = line.querySelector('input');
        const notes = input ? input.value : text(line.querySelector('[data-testid="line-notes"]'));
        lines.push(qty + '× ' + name + (notes ? ' (' + notes + ')' : ''));
      }
      parts[part.getAttribute('data-person') ?? '?'] = {
        total: text(part.querySelector('[data-testid="part-total"]')),
        lines: lines.sort(),
      };
    }
    return { groupTotal: text(document.querySelector('[data-testid="group-total"]')), parts };
  });
  // Cada pantalla muestra "Tu parte" primero: ordenamos por persona para poder comparar.
  const parts = Object.fromEntries(
    Object.entries(raw.parts).sort(([a], [b]) => a.localeCompare(b)),
  );
  return { groupTotal: raw.groupTotal, parts };
}
