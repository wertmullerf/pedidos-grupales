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

export async function newPhone(browser: Browser, extra: BrowserContextOptions = {}) {
  const context = await browser.newContext({ ...MOBILE, baseURL: BASE_URL, ...extra });
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
  const parts = page.getByTestId('part');
  const result: Record<string, { total: string; lines: string[] }> = {};
  for (const part of await parts.all()) {
    const person = (await part.getAttribute('data-person')) ?? '?';
    const total = clean(await part.getByTestId('part-total').textContent());
    const lines: string[] = [];
    for (const line of await part.getByTestId('line').all()) {
      const name = (await line.locator('[class*="lineName"]').textContent())?.trim() ?? '';
      const qtyEl = line.locator('[class*="lineQty"], [class*="stepperQty"]').first();
      const qty = (await qtyEl.textContent())?.replace('×', '').trim() ?? '';
      const notesInput = line.locator('input');
      const notesText = line.locator('[class*="lineNotes"]');
      const notes =
        (await notesInput.count()) > 0
          ? await notesInput.inputValue()
          : (await notesText.count()) > 0
            ? ((await notesText.textContent()) ?? '')
            : '';
      lines.push(`${qty}× ${name}${notes ? ` (${notes})` : ''}`);
    }
    result[person] = { total, lines: lines.sort() };
  }
  const groupTotal = clean(await page.getByTestId('group-total').textContent());
  // Cada pantalla muestra "Tu parte" primero: ordenamos por persona para poder comparar.
  const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
  return { groupTotal, parts: sorted };
}

/** Intl es-AR separa "$" del número con un espacio no separable: lo normalizamos. */
function clean(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}
