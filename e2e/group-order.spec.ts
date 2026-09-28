import { expect, test, type Page } from '@playwright/test';
import {
  BASE_URL,
  createOrder,
  goTab,
  joinOrder,
  newPhone,
  readGroupOrder,
  settle,
  tapAdd,
  writeNote,
} from './helpers';

/** Las tres pantallas muestran exactamente el mismo pedido (ítems, cantidades, aclaraciones y totales). */
async function expectSameOrder(pages: Page[]) {
  let views: Awaited<ReturnType<typeof readGroupOrder>>[] = [];
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    views = await Promise.all(pages.map(readGroupOrder));
    if (views.every((v) => JSON.stringify(v) === JSON.stringify(views[0]))) return views[0]!;
    await pages[0]!.waitForTimeout(250);
  }
  throw new Error(`Las pantallas no convergieron:
${JSON.stringify(views, null, 2)}`);
}

test('3 personas arman un pedido en simultáneo y todas las pantallas terminan iguales', async ({
  browser,
}) => {
  // Modo debug: el test usa la actividad y "Simular desconexión", que la UI pública no muestra.
  const host = await newPhone(browser, { debug: true });
  const beto = await newPhone(browser, { debug: true });
  const cata = await newPhone(browser, { debug: true });
  const phones = [host.page, beto.page, cata.page];

  // --- Host crea, invitados se unen por link ---
  const code = await createOrder(host.page, 'hamburgueseria-test', 'Ana');
  await Promise.all([
    joinOrder(beto.page, 'hamburgueseria-test', code, 'Beto'),
    joinOrder(cata.page, 'hamburgueseria-test', code, 'Cata'),
  ]);
  for (const page of phones) {
    await expect(page.getByTestId('people').getByRole('listitem')).toHaveCount(3);
  }

  // --- Los tres operan a la vez (incluye ráfagas de toques que agrupa el debounce) ---
  await Promise.all([
    tapAdd(host.page, 'Clásica', 3),
    (async () => {
      await tapAdd(beto.page, 'Doble Ahumada');
      await tapAdd(beto.page, 'Papas rústicas', 4, 60);
    })(),
    (async () => {
      await tapAdd(cata.page, 'Veggie de Lentejas', 2);
      await tapAdd(cata.page, 'Limonada de la casa');
    })(),
  ]);
  await goTab(beto.page, 'Pedido');
  await writeNote(beto.page, 'Doble Ahumada', 'sin cebolla');
  await beto.page.getByRole('button', { name: 'Restar Papas rústicas' }).click();
  for (const page of phones) await settle(page, 300);

  let order = await expectSameOrder(phones);
  expect(order.parts.Ana!.lines).toEqual(['3× Clásica']);
  expect(order.parts.Beto!.lines).toEqual(['1× Doble Ahumada (sin cebolla)', '3× Papas rústicas']);
  expect(order.parts.Cata!.lines).toEqual(['1× Limonada de la casa', '2× Veggie de Lentejas']);
  // 3×9.500 + 12.500 + 3×4.200 + 2×9.800 + 3.200 = 76.400
  expect(order.groupTotal).toBe('$ 76.400');
  await expect(beto.page.getByTestId('my-total')).toHaveText('$ 25.100');

  // --- Cata pierde la conexión; mientras tanto los demás siguen agregando ---
  await goTab(cata.page, 'Actividad');
  await cata.page.getByRole('button', { name: 'Simular desconexión' }).click();
  await expect(cata.page.getByTestId('connection')).toHaveText('Reconectando…');
  await tapAdd(host.page, 'Gaseosa', 2);
  await tapAdd(beto.page, 'Limonada de la casa');
  await settle(host.page);
  // Al volver resincroniza y queda igual que el resto.
  await expect(cata.page.getByTestId('connection')).toHaveText('Sincronizado', { timeout: 15_000 });
  await expect(cata.page.getByTestId('activity')).toContainText('Resincronizado');
  order = await expectSameOrder(phones);
  expect(order.groupTotal).toBe('$ 84.600');

  // --- El host cierra mientras Beto está desconectado: su cambio llega tarde y se rechaza claro ---
  await goTab(beto.page, 'Actividad');
  await beto.page.getByRole('button', { name: 'Simular desconexión' }).click();
  await expect(beto.page.getByTestId('connection')).toHaveText('Reconectando…');
  await host.page.getByRole('button', { name: 'Cerrar pedido' }).click();
  await expect(host.page.getByRole('heading', { name: 'Resumen final' })).toBeVisible();
  // Beto todavía ve el pedido abierto (no se enteró del cierre) y agrega algo.
  await tapAdd(beto.page, 'Veggie de Lentejas');
  await expect(
    beto.page.getByText('El pedido se cerró, tu último cambio no se aplicó'),
  ).toBeVisible({ timeout: 15_000 });
  // El cambio rechazado se revirtió: todos siguen viendo lo mismo.
  order = await expectSameOrder(phones);
  expect(order.groupTotal).toBe('$ 84.600');
  await goTab(cata.page, 'Pedido');
  await expect(cata.page.getByText('cerró el pedido y está revisando')).toBeVisible();

  // --- La cocina de la sucursal está mirando; el host envía ---
  const kitchenCtx = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
  });
  const kitchen = await kitchenCtx.newPage();
  const branches = await (await fetch(`${BASE_URL}/api/t/hamburgueseria-test/branches`)).json();
  // La home elige la primera sucursal abierta (mismo orden que la API).
  const branch = branches.find((b: { isOpen: boolean }) => b.isOpen);
  await kitchen.goto(`/t/hamburgueseria-test/branch/${branch.id}/kitchen?debug=1`);
  await expect(kitchen.getByText('En vivo')).toBeVisible();

  await host.page.getByRole('button', { name: /^Enviar a/ }).click();

  for (const page of phones) {
    await expect(page.getByTestId('submitted')).toBeVisible();
    await expect(page.getByTestId('final-total')).toHaveText('$ 84.600');
  }
  const summaries = await Promise.all(
    phones.map(async (p) =>
      (await p.getByTestId('final-summary').innerText()).replace(/ \(vos\)/g, ''),
    ),
  );
  expect(new Set(summaries).size).toBe(1);

  const ticket = kitchen.getByTestId('kitchen-ticket').filter({ hasText: `#${code}` });
  await expect(ticket).toBeVisible();
  await expect(ticket).toContainText('sin cebolla');
  await expect(ticket).toContainText('$ 84.600');
});
