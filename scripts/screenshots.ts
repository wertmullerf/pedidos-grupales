// Capturas de las pantallas principales (mobile y desktop) en demo/screenshots/.
// Solo UI pública: sin modo debug. Requiere el stack de docker (docker compose up -d) y el front
// (npm run dev:web).
import { mkdir, rm } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import {
  BASE_URL,
  TENANT,
  createOrder,
  goTab,
  joinOrder,
  newPhone,
  settle,
  tapAdd,
  writeNote,
} from '../e2e/helpers';

const OUT = 'demo/screenshots';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400); // que terminen las animaciones de entrada
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ✓ ${name}.png`);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  const host = await newPhone(browser);
  await host.page.goto('/');
  await host.page.getByText('Palermo').waitFor();
  await shot(host.page, '01-inicio-mobile');

  const code = await createOrder(host.page, TENANT, 'Ana');
  const beto = await newPhone(browser);
  const cata = await newPhone(browser);

  await beto.page.goto(`/t/${TENANT}/o/${code}`);
  await beto.page.getByText('te invitó a pedir en grupo').waitFor();
  await shot(beto.page, '02-sumarse-mobile');
  await joinOrder(beto.page, TENANT, code, 'Beto');
  await joinOrder(cata.page, TENANT, code, 'Cata');

  // Desktop del host abierto desde el principio (la identidad se guarda por pestaña: la copiamos).
  const desk = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    baseURL: BASE_URL,
    locale: 'es-AR',
  });
  const desktopHost = await desk.newPage();
  const identity = await host.page.evaluate(() => ({ ...sessionStorage }));
  await desktopHost.goto('/');
  await desktopHost.evaluate((items) => {
    for (const [k, v] of Object.entries(items)) sessionStorage.setItem(k, v as string);
  }, identity);
  await desktopHost.goto(`/t/${TENANT}/o/${code}`);
  await desktopHost.getByTestId('connection').filter({ hasText: 'Conectado' }).waitFor();

  await tapAdd(host.page, 'Clásica', 2);
  await tapAdd(beto.page, 'Doble Ahumada');
  await tapAdd(beto.page, 'Papas rústicas', 2);
  await tapAdd(cata.page, 'Veggie de Lentejas');
  await settle(cata.page);
  await goTab(beto.page, 'Pedido');
  await writeNote(beto.page, 'Doble Ahumada', 'sin cebolla');
  // Cata sigue mirando el menú: los demás la ven "eligiendo…".
  await cata.page.getByRole('heading', { name: 'Bebidas' }).click();
  await settle(host.page, 900);
  await shot(host.page, '03-menu-mobile');

  // Detalle de producto (bottom sheet).
  await cata.page.getByRole('button', { name: 'Ver Limonada de la casa' }).click();
  await cata.page.getByRole('dialog').getByText('Aclaraciones').waitFor();
  await cata.page.getByPlaceholder('Ej: sin cebolla').fill('con poco hielo');
  await shot(cata.page, '04-detalle-producto-mobile');

  // Ana mira el pedido del grupo y justo llega el cambio de Cata: resaltado + aviso discreto.
  await goTab(host.page, 'Pedido');
  await settle(host.page, 400);
  await cata.page.getByRole('button', { name: /^Agregar ·/ }).click();
  await host.page.getByText('Cata agregó Limonada de la casa').waitFor();
  await host.page.waitForTimeout(250); // mitad del resaltado
  await host.page.screenshot({ path: `${OUT}/05-pedido-grupo-cambio-remoto-mobile.png` });
  console.log('  ✓ 05-pedido-grupo-cambio-remoto-mobile.png');

  // Desktop: menú y pedido lado a lado.
  await tapAdd(beto.page, 'Gaseosa');
  await settle(desktopHost, 1500);
  await shot(desktopHost, '06-pedido-desktop');

  // Cierre del host: resumen final (bottom sheet) y banner para los invitados.
  await host.page.getByRole('button', { name: 'Cerrar pedido' }).click();
  await host.page.getByRole('heading', { name: 'Resumen final' }).waitFor();
  await shot(host.page, '07-resumen-final-mobile');
  await goTab(beto.page, 'Pedido');
  await beto.page.getByText('cerró el pedido y está revisando').waitFor();
  await settle(beto.page, 2600); // que se vaya el aviso
  await shot(beto.page, '08-pedido-cerrado-invitado-mobile');

  await host.page.getByRole('button', { name: /^Enviar a sucursal/ }).click();
  await host.page.getByText('¡Pedido enviado!').waitFor();
  await shot(host.page, '09-pedido-enviado-mobile');

  // Home en desktop.
  const deskHome = await desk.newPage();
  await deskHome.goto('/');
  await deskHome.getByText('Palermo').waitFor();
  await shot(deskHome, '10-inicio-desktop');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
