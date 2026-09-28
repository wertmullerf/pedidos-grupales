// Graba 3 celulares (Ana, Beto, Cata) usando la app en vivo y exporta un timeline para Remotion
// (apps/video): cuadros de pantalla con la hora exacta en que se pintaron, toques, subtítulos y
// cuándo se pintó cada cambio en cada pantalla (latencia real).
//
// Se graba con el screencast de Chrome (CDP) y no con el video de Playwright: cada cuadro trae su
// timestamp real, en el mismo reloj que los toques y los eventos. Así las tres pantallas quedan
// alineadas al milisegundo en el video final (con el video de Playwright había que estimar cuándo
// arrancaba cada grabación y los celulares quedaban desfasados).
//
// Requiere el stack de docker y el front corriendo (npm run dev:web).
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  chromium,
  expect,
  type BrowserContext,
  type CDPSession,
  type Page,
} from '@playwright/test';
import { BASE_URL, MOBILE, TENANT, goTab, tapAdd } from '../e2e/helpers';

const OUT = 'apps/video/public/recording';
/** Área de la app en un iPhone 17 (402×874 pt) debajo de la barra de estado. */
const VIEWPORT = { width: 402, height: 820 };
const DPR = 2;

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

interface Frame {
  t: number;
  file: string;
}
interface Phone {
  name: string;
  role: string;
  participantId: string | null;
  color?: string;
  frames: Frame[];
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

/** Graba la pantalla con el screencast de CDP: un JPEG por cuadro pintado, con su timestamp real. */
async function startScreencast(page: Page, context: BrowserContext, dir: string, frames: Frame[]) {
  await mkdir(dir, { recursive: true });
  const cdp: CDPSession = await context.newCDPSession(page);
  let n = 0;
  const writes: Promise<void>[] = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const t = metadata.timestamp ? metadata.timestamp * 1000 : Date.now();
    const file = `${String(n++).padStart(5, '0')}.jpg`;
    frames.push({ t, file: `recording/${path.basename(dir)}/${file}` });
    writes.push(writeFile(path.join(dir, file), Buffer.from(data, 'base64')));
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 88,
    maxWidth: VIEWPORT.width * DPR,
    maxHeight: VIEWPORT.height * DPR,
    everyNthFrame: 1,
  });
  return async () => {
    await cdp.send('Page.stopScreencast').catch(() => {});
    await Promise.all(writes);
  };
}

/** Espera a que las tres pantallas muestren el mismo total del grupo (y lo devuelve). */
async function expectSameTotal(pages: Page[], expected?: string) {
  const read = () =>
    Promise.all(
      pages.map(async (p) =>
        ((await p.getByTestId('group-total').textContent()) ?? '').replace(/\s+/g, ' ').trim(),
      ),
    );
  await expect
    .poll(async () => new Set(await read()).size, {
      message: 'las 3 pantallas muestran el mismo total',
      timeout: 5000,
    })
    .toBe(1);
  const [total] = await read();
  if (expected) expect(total).toBe(expected);
  return total!;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (let i = 0; i < PEOPLE.length; i++) {
    const context = await browser.newContext({
      ...MOBILE,
      viewport: VIEWPORT,
      deviceScaleFactor: DPR,
      baseURL: BASE_URL,
    });
    await context.addInitScript(INSTRUMENT);
    contexts.push(context);
    pages.push(await context.newPage());
  }
  const [ana, beto, cata] = pages as [Page, Page, Page];

  // --- Preparación (no se graba) ---
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
  await goTab(ana, 'Pedido');
  await expectSameTotal(pages, '$ 9.500');
  await pause(2800); // que se vayan los avisos de la preparación

  // --- Grabación ---
  const phones: Phone[] = PEOPLE.map((p) => ({ ...p, participantId: null, frames: [] }));
  const stops = await Promise.all(
    pages.map((page, i) =>
      startScreencast(page, contexts[i]!, path.join(OUT, `phone-${i}`), phones[i]!.frames),
    ),
  );
  await pause(600);

  const marks: Mark[] = [];
  const mark = (kind: Mark['kind'], text?: string) => marks.push({ t: Date.now(), kind, text });
  const checks: string[] = [];
  const actionStart = Date.now();

  mark('subtitle', 'Cada uno elige *desde su celular*');
  await pause(1500);
  await beto.getByRole('button', { name: 'Agregar Doble Ahumada', exact: true }).click();
  checks.push(await expectSameTotal(pages, '$ 22.000'));
  await pause(700);
  mark('subtitle', 'Lo que suma uno aparece *al instante*');
  await pause(1600);
  await cata.getByRole('button', { name: 'Agregar Veggie de Lentejas', exact: true }).click();
  checks.push(await expectSameTotal(pages, '$ 31.800'));
  await pause(2000);

  // Momento clave: dos personas suman el mismo producto exactamente a la vez.
  mark('subtitle', 'Dos personas suman lo mismo *a la vez*…');
  await Promise.all(
    [beto, cata].map((p) =>
      p.evaluate(() =>
        document
          .querySelector('[data-name="Papas rústicas"]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      ),
    ),
  );
  await pause(1200);
  mark('zoom-in');
  await Promise.all([
    beto.getByRole('button', { name: 'Agregar Papas rústicas', exact: true }).click(),
    cata.getByRole('button', { name: 'Agregar Papas rústicas', exact: true }).click(),
  ]);
  checks.push(await expectSameTotal(pages, '$ 40.200'));
  await pause(1000);
  mark('subtitle', '…y el total queda *exacto*');
  await pause(2600);
  mark('zoom-out');
  await pause(700);

  mark('subtitle', 'Al cerrar, cada uno ve *cuánto paga*');
  await ana.getByRole('button', { name: 'Cerrar pedido' }).click();
  await ana.getByRole('heading', { name: 'Resumen final' }).waitFor();
  await pause(3000);
  const actionEnd = Date.now();

  for (const stop of stops) await stop();

  // --- Exportar ---
  const taps: Tap[] = [];
  const records: Rec[] = [];
  for (const [i, page] of pages.entries()) {
    const data = await page.evaluate(() => {
      const w = window as unknown as { __pgRecord: unknown[]; __pgTaps: unknown[] };
      const identity = Object.entries(sessionStorage).find(([k]) => k.startsWith('pedido:'))?.[1];
      return { records: w.__pgRecord, taps: w.__pgTaps, identity };
    });
    phones[i]!.participantId = data.identity ? JSON.parse(data.identity).participantId : null;
    for (const tap of data.taps as Omit<Tap, 'phone'>[]) taps.push({ phone: i, ...tap });
    for (const rec of data.records as Omit<Rec, 'phone'>[]) records.push({ phone: i, ...rec });
  }
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
    phone.color = p?.color ?? '#999999';
  }

  for (const context of contexts) await context.close();
  await browser.close();

  const timeline = {
    viewport: VIEWPORT,
    dpr: DPR,
    code,
    actionStart,
    actionEnd,
    phones,
    marks,
    taps,
    records,
  };
  await writeFile(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 2));

  console.log(`  cuadros: ${phones.map((p) => `${p.name} ${p.frames.length}`).join(' · ')}`);
  console.log(`  total igual en las 3 pantallas después de cada paso: ${checks.join(' → ')}`);
  for (const tap of taps.filter((t) => t.t >= actionStart)) {
    const me = phones[tap.phone]!.participantId;
    const ev = records
      .filter((r) => r.phone === tap.phone && r.kind === 'applied' && r.by === me && r.t >= tap.t)
      .sort((a, b) => a.t - b.t)[0];
    if (!ev || ev.type !== 'item_added') continue;
    const remote = records
      .filter((r) => r.kind === 'painted' && r.version === ev.version && r.phone !== tap.phone)
      .map((r) => Math.round(r.t - tap.t));
    console.log(
      `  ${phones[tap.phone]!.name} v${ev.version}: pintado en los demás a ${remote.join(' / ')} ms`,
    );
  }
  console.log(`\n✓ ${OUT}/ (pedido ${code}, ${((actionEnd - actionStart) / 1000).toFixed(1)} s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
