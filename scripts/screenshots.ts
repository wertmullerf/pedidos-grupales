// Capturas de las pantallas principales (mobile y desktop) en demo/screenshots/.
// Requiere el stack de docker (docker compose up -d) y el front (npm run dev:web).
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import {
  BASE_URL,
  createOrder,
  goTab,
  joinOrder,
  newPhone,
  settle,
  tapAdd,
  writeNote,
} from '../e2e/helpers';

const OUT = 'demo/screenshots';

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(350); // que terminen las animaciones de entrada
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`  ✓ ${name}.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // Landing de la demo (desktop).
  const desk = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    baseURL: BASE_URL,
    locale: 'es-AR',
  });
  const landing = await desk.newPage();
  await landing.goto('/');
  await landing.getByRole('heading', { name: 'Brasaburg' }).waitFor();
  await shot(landing, '01-landing-desktop');

  // Home de cada cadena: el mismo front, otra marca.
  const smash = await newPhone(browser);
  await smash.page.goto('/t/smashlab');
  await smash.page.getByText('Smashlab Núñez').waitFor();
  await shot(smash.page, '02-home-smashlab-mobile');

  const host = await newPhone(browser);
  await host.page.goto('/t/brasaburg');
  await host.page.getByText('Brasaburg Palermo').waitFor();
  await shot(host.page, '03-home-brasaburg-mobile');

  const code = await createOrder(host.page, 'brasaburg', 'Ana');
  const beto = await newPhone(browser);
  const cata = await newPhone(browser);

  await beto.page.goto(`/t/brasaburg/o/${code}`);
  await beto.page.getByText('te invitó a pedir en grupo').waitFor();
  await shot(beto.page, '04-unirse-mobile');
  await joinOrder(beto.page, 'brasaburg', code, 'Beto');
  await joinOrder(cata.page, 'brasaburg', code, 'Cata');

  // Pestaña de desktop del host abierta desde el principio: su panel de actividad junta toda la historia.
  // La identidad se guarda por pestaña: copiamos la del host.
  const desktopHost = await desk.newPage();
  const identity = await host.page.evaluate(() => ({ ...sessionStorage }));
  await desktopHost.goto('/');
  await desktopHost.evaluate((items) => {
    for (const [k, v] of Object.entries(items)) sessionStorage.setItem(k, v as string);
  }, identity);
  await desktopHost.goto(`/t/brasaburg/o/${code}`);
  await desktopHost.getByTestId('connection').filter({ hasText: 'Conectado' }).waitFor();

  await tapAdd(host.page, 'Brasa Clásica', 2);
  await tapAdd(beto.page, 'Doble Ahumada');
  await tapAdd(beto.page, 'Papas rústicas', 2);
  await tapAdd(cata.page, 'Veggie de Lentejas');
  await tapAdd(cata.page, 'Limonada de la casa');
  await settle(cata.page);
  await goTab(beto.page, 'Pedido');
  await writeNote(beto.page, 'Doble Ahumada', 'sin cebolla');
  // Cata sigue mirando el menú: los demás la ven "eligiendo…".
  await cata.page.getByRole('heading', { name: 'Bebidas' }).hover();
  await cata.page.mouse.down();
  await cata.page.mouse.up();
  await settle(host.page, 1200);
  await shot(host.page, '05-menu-mobile');

  await goTab(host.page, 'Pedido');
  await shot(host.page, '06-pedido-grupo-mobile');

  // Desconexión y resync en la pantalla de Cata.
  await goTab(cata.page, 'Actividad');
  await cata.page.getByRole('button', { name: 'Simular desconexión' }).click();
  await cata.page.getByTestId('connection').filter({ hasText: 'Reconectando' }).waitFor();
  await tapAdd(beto.page, 'Gaseosa');
  await shot(cata.page, '07-reconectando-mobile');
  await cata.page
    .getByTestId('connection')
    .filter({ hasText: 'Sincronizado' })
    .waitFor({ timeout: 10_000 });
  await shot(cata.page, '08-actividad-resync-mobile');

  // Desktop: menú, pedido y actividad lado a lado.
  await tapAdd(beto.page, 'Gaseosa');
  await settle(desktopHost, 400);
  await shot(desktopHost, '09-pedido-desktop');

  // Cierre del host: resumen final y banner para los invitados.
  await host.page.getByRole('button', { name: 'Cerrar pedido' }).click();
  await host.page.getByRole('heading', { name: 'Resumen final' }).waitFor();
  await shot(host.page, '10-resumen-final-mobile');
  await goTab(beto.page, 'Pedido');
  await beto.page.getByText('cerró el pedido y está revisando').waitFor();
  await shot(beto.page, '11-pedido-cerrado-invitado-mobile');

  // Cocina de la sucursal abierta antes de enviar, para ver el ticket llegar en vivo.
  const kitchen = await desk.newPage();
  const branches = await (await fetch(`${BASE_URL}/api/t/brasaburg/branches`)).json();
  await kitchen.goto(`/t/brasaburg/branch/${branches[0].id}/kitchen`);
  await kitchen.getByText('En vivo').waitFor();

  await host.page.getByRole('button', { name: /^Enviar a/ }).click();
  await host.page.getByText('¡Pedido enviado!').waitFor();
  await shot(host.page, '12-pedido-enviado-mobile');
  await kitchen.getByText(`#${code}`).waitFor();
  await shot(kitchen, '13-cocina-desktop');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
