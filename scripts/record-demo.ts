// Graba 3 celulares (Ana, Beto, Cata) usando la app en vivo y exporta los videos + un timeline con
// los toques, los subtítulos y cuándo se PINTÓ cada cambio en cada pantalla (latencia real).
// Remotion (apps/video) arma el video final a partir de eso.
//
// Requiere el stack de docker y el front corriendo (npm run dev:web).
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL, MOBILE, TENANT, goTab, tapAdd } from '../e2e/helpers';

const OUT = 'apps/video/public/recording';
const VIEWPORT = MOBILE.viewport!;

const PEOPLE = [
  { name: 'Ana', role: 'arma el pedido' },
  { name: 'Beto', role: 'invitado' },
  { name: 'Cata', role: 'invitada' },
] as const;

// Instrumentación: la app registra en window.__pgRecord cuándo aplica y pinta cada evento;
// acá sumamos cada toque (hora epoch y posición en la pantalla).
const INSTRUMENT = () => {
  const w = window as unknown as { __pgRecord: unknown[]; __pgTaps: unknown[] };
  w.__pgRecord = [];
  w.__pgTaps = [];
  document.addEventListener(
    'pointerdown',
    (e) =>
      w.__pgTaps.push({
        t: performance.timeOrigin + performance.now(),
        x: e.clientX,
        y: e.clientY,
      }),
    true,
  );
};

interface Phone {
  name: string;
  role: string;
  participantId: string | null;
  videoStart: number;
  file: string;
  color?: string;
}
interface Tap {
  phone: number;
  t: number;
  x: number;
  y: number;
}
interface Rec {
  phone: number;
  kind: 'applied' | 'painted';
  t: number;
  version: number;
  type: string;
  by: string | null;
}

interface Mark {
  t: number;
  kind: 'subtitle' | 'zoom-in' | 'zoom-out';
  text?: string;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scrollToProduct(page: Page, product: string) {
  await page.evaluate((name) => {
    document
      .querySelector(`[data-name="${name}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, product);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const videoStart: number[] = [];
  for (const [i] of PEOPLE.entries()) {
    const context = await browser.newContext({
      ...MOBILE,
      baseURL: BASE_URL,
      recordVideo: { dir: path.join(OUT, `raw-${i}`), size: VIEWPORT },
    });
    await context.addInitScript(INSTRUMENT);
    contexts.push(context);
    // El video arranca cuando se crea la página: tomamos el punto medio como origen.
    const before = Date.now();
    pages.push(await context.newPage());
    videoStart.push((before + Date.now()) / 2);
  }
  const [ana, beto, cata] = pages as [Page, Page, Page];

  // --- Preparación (queda fuera del corte final) ---
  await ana.goto('/');
  await ana.getByPlaceholder('Tu nombre').fill('Ana');
  await ana.getByRole('button', { name: 'Crear pedido grupal' }).click();
  await ana.waitForURL(/\/o\/[A-Z0-9]{6}$/);
  const code = ana.url().split('/').pop()!;
  for (const [page, name] of [
    [beto, 'Beto'],
    [cata, 'Cata'],
  ] as const) {
    await page.goto(`/t/${TENANT}/o/${code}`);
    await page.getByPlaceholder('¿Cómo te llamás?').fill(name);
    await page.getByRole('button', { name: 'Sumarme al pedido' }).click();
  }
  for (const page of pages) {
    await page.getByTestId('connection').filter({ hasText: 'Conectado' }).waitFor();
  }
  await tapAdd(ana, 'Clásica');
  await pause(600);
  await goTab(ana, 'Pedido');
  await pause(2500); // que se vayan los avisos de la preparación

  // --- Acción ---
  const marks: Mark[] = [];
  const mark = (kind: Mark['kind'], text?: string) => marks.push({ t: Date.now(), kind, text });
  const actionStart = Date.now();

  mark('subtitle', 'Cada uno elige desde su celular');
  await pause(1500);
  await beto.getByRole('button', { name: 'Agregar Doble Ahumada', exact: true }).click();
  await pause(900);
  mark('subtitle', 'Lo que suma uno aparece al instante en los demás');
  await pause(1700);
  await cata.getByRole('button', { name: 'Agregar Veggie de Lentejas', exact: true }).click();
  await pause(2300);

  // Momento clave: dos personas suman el mismo producto exactamente a la vez.
  mark('subtitle', 'Dos personas suman lo mismo a la vez…');
  await Promise.all([
    scrollToProduct(beto, 'Papas rústicas'),
    scrollToProduct(cata, 'Papas rústicas'),
  ]);
  await pause(1200);
  mark('zoom-in');
  await Promise.all([
    beto.getByRole('button', { name: 'Agregar Papas rústicas', exact: true }).click(),
    cata.getByRole('button', { name: 'Agregar Papas rústicas', exact: true }).click(),
  ]);
  await pause(1300);
  mark('subtitle', '…y el total queda exacto, sin pisarse');
  await pause(2400);
  mark('zoom-out');
  await pause(700);

  mark('subtitle', 'Ana cierra el pedido: cada uno ve cuánto paga');
  await ana.getByRole('button', { name: 'Cerrar pedido' }).click();
  await ana.getByRole('heading', { name: 'Resumen final' }).waitFor();
  await pause(3200);
  const actionEnd = Date.now();

  // --- Exportar ---
  const phones: Phone[] = [];
  const taps: Tap[] = [];
  const records: Rec[] = [];
  for (const [i, page] of pages.entries()) {
    const data = await page.evaluate(() => {
      const w = window as unknown as { __pgRecord: unknown[]; __pgTaps: unknown[] };
      const identity = Object.entries(sessionStorage).find(([k]) => k.startsWith('pedido:'))?.[1];
      return { records: w.__pgRecord, taps: w.__pgTaps, identity };
    });
    const identity = data.identity ? JSON.parse(data.identity) : null;
    phones.push({
      name: PEOPLE[i]!.name,
      role: PEOPLE[i]!.role,
      participantId: identity?.participantId ?? null,
      videoStart: videoStart[i]!,
      file: `recording/phone-${i}.webm`,
    });
    for (const tap of data.taps as Omit<Tap, 'phone'>[]) taps.push({ phone: i, ...tap });
    for (const rec of data.records as Omit<Rec, 'phone'>[]) records.push({ phone: i, ...rec });
  }
  // Colores de cada participante, tal como los asignó el server.
  const snapshot = await ana.evaluate(async (c) => {
    const identity = Object.entries(sessionStorage).find(([k]) => k.startsWith('pedido:'))?.[1];
    const token = identity ? JSON.parse(identity).token : '';
    const res = await fetch(`/api/t/hamburgueseria-test/orders/${c}/snapshot`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return res.json();
  }, code);
  for (const phone of phones) {
    const p = snapshot.participants.find((x: { id: string }) => x.id === phone.participantId);
    Object.assign(phone, { color: p?.color ?? '#999999' });
  }

  for (const context of contexts) await context.close();
  for (const [i, page] of pages.entries()) {
    await page.video()!.saveAs(path.join(OUT, `phone-${i}.webm`));
  }
  await browser.close();
  for (const [i] of PEOPLE.entries())
    await rm(path.join(OUT, `raw-${i}`), { recursive: true, force: true });

  const timeline = {
    viewport: VIEWPORT,
    code,
    actionStart,
    actionEnd,
    phones,
    marks,
    taps,
    records,
  };
  await writeFile(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 2));

  // Resumen de latencias medidas (tap en un celular → pintado en los otros).
  const own = (i: number, rec: { by: string | null }) => rec.by === phones[i]!.participantId;
  for (const tap of taps as { phone: number; t: number }[]) {
    const ev = (
      records as {
        phone: number;
        kind: string;
        t: number;
        version: number;
        by: string;
        type: string;
      }[]
    )
      .filter(
        (r) =>
          r.phone === tap.phone &&
          r.kind === 'applied' &&
          own(tap.phone, r) &&
          r.t >= tap.t &&
          r.t - tap.t < 1500,
      )
      .sort((a, b) => a.t - b.t)[0];
    if (!ev || ev.type !== 'item_added') continue;
    const remote = (records as { phone: number; kind: string; t: number; version: number }[])
      .filter((r) => r.kind === 'painted' && r.version === ev.version && r.phone !== tap.phone)
      .map((r) => Math.round(r.t - tap.t));
    console.log(
      `  ${phones[tap.phone]!.name} v${ev.version}: pintado en los demás a ${remote.join(' / ')} ms`,
    );
  }
  console.log(
    `\n✓ ${OUT}/ (pedido ${code}, ${((actionEnd - actionStart) / 1000).toFixed(1)} s de acción)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
