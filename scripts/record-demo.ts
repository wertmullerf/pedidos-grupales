// Graba la demo para LinkedIn: 3 celulares (host + 2 invitados) operando en vivo, combinados
// lado a lado en demo/demo.mp4 y demo/demo.gif. Ritmo pausado a propósito.
// Requiere el stack de docker (docker compose up -d) y el front (npm run dev:web).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import ffmpegPath from 'ffmpeg-static';
import { BASE_URL, MOBILE, goTab, tapAdd, writeNote } from '../e2e/helpers';

const OUT_DIR = 'demo';
const RAW_DIR = path.join(OUT_DIR, 'raw');
// Playwright graba en píxeles CSS (ignora el DPR): grabamos al tamaño del viewport y
// componemos a resolución nativa, sin reescalar, para que el texto quede nítido.
const VIDEO = { width: MOBILE.viewport!.width, height: MOBILE.viewport!.height };

const PEOPLE = [
  { name: 'Ana', caption: 'Ana · arma el pedido' },
  { name: 'Beto', caption: 'Beto · invitado' },
  { name: 'Cata', caption: 'Cata · invitada' },
] as const;

/** Muestra un círculo donde se toca: en el video no hay cursor. */
const TAP_INDICATOR = `
  document.addEventListener('pointerdown', (e) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:' + (e.clientX - 24) + 'px;top:' + (e.clientY - 24) +
      'px;width:48px;height:48px;border-radius:50%;background:rgba(20,20,30,.22);' +
      'border:3px solid rgba(255,255,255,.95);box-shadow:0 2px 10px rgba(0,0,0,.25);' +
      'pointer-events:none;z-index:2147483647;transition:transform .55s ease-out,opacity .55s ease-out;';
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = 'scale(1.7)'; d.style.opacity = '0'; });
    setTimeout(() => d.remove(), 650);
  }, true);
`;

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

async function typeSlowly(page: Page, placeholder: string, text: string) {
  const input = page.getByPlaceholder(placeholder);
  await input.click();
  await input.pressSequentially(text, { delay: 110 });
}

async function main() {
  if (!ffmpegPath) throw new Error('ffmpeg-static no trajo un binario para esta plataforma');
  // --compose-only: rearma el video a partir de la última grabación, sin volver a grabar.
  if (process.argv.includes('--compose-only')) {
    compose(await rawVideos());
    console.log(`
✓ ${OUT_DIR}/demo.mp4 y ${OUT_DIR}/demo.gif`);
    return;
  }
  await rm(RAW_DIR, { recursive: true, force: true });
  await mkdir(RAW_DIR, { recursive: true });

  const browser = await chromium.launch();
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  // Las tres grabaciones arrancan juntas para que queden sincronizadas.
  for (const [i] of PEOPLE.entries()) {
    const context = await browser.newContext({
      ...MOBILE,
      baseURL: BASE_URL,
      recordVideo: { dir: path.join(RAW_DIR, String(i)), size: VIDEO },
    });
    await context.addInitScript(TAP_INDICATOR);
    contexts.push(context);
  }
  pages.push(...(await Promise.all(contexts.map((c) => c.newPage()))));
  const [ana, beto, cata] = pages as [Page, Page, Page];

  // Arranque: la home de la cadena en las tres pantallas.
  await Promise.all(pages.map((p) => p.goto('/t/brasaburg')));
  await pause(ana, 1500);

  // Ana arma el pedido.
  await ana.getByText('Brasaburg Palermo').click();
  await typeSlowly(ana, 'Tu nombre', 'Ana');
  await pause(ana, 500);
  await ana.getByRole('button', { name: 'Crear pedido grupal' }).click();
  await ana.waitForURL(/\/o\/[A-Z0-9]{6}$/);
  const code = ana.url().split('/').pop()!;
  await pause(ana, 1800);

  // Beto y Cata abren el link y se suman.
  await Promise.all([beto.goto(`/t/brasaburg/o/${code}`), cata.goto(`/t/brasaburg/o/${code}`)]);
  await pause(ana, 1200);
  await typeSlowly(beto, '¿Cómo te llamás?', 'Beto');
  await beto.getByRole('button', { name: 'Sumarme al pedido' }).click();
  await pause(ana, 900);
  await typeSlowly(cata, '¿Cómo te llamás?', 'Cata');
  await cata.getByRole('button', { name: 'Sumarme al pedido' }).click();
  await pause(ana, 1800);

  // Ana mira el pedido del grupo mientras los demás eligen.
  await goTab(ana, 'Pedido');
  await pause(ana, 900);
  await tapAdd(beto, 'Doble Ahumada');
  await pause(ana, 1300);
  await tapAdd(cata, 'Veggie de Lentejas');
  await pause(ana, 1300);
  // Toques seguidos: se ven al instante y viajan agrupados.
  await tapAdd(beto, 'Papas rústicas', 3, 220);
  await pause(ana, 1500);
  await tapAdd(cata, 'Limonada de la casa');
  await pause(ana, 1200);

  await goTab(ana, 'Menú');
  await pause(ana, 700);
  await tapAdd(ana, 'Brasa Clásica', 2, 350);
  await pause(ana, 1200);

  await goTab(beto, 'Pedido');
  await pause(beto, 900);
  await beto.getByLabel('Aclaración para Doble Ahumada').click();
  await beto
    .getByLabel('Aclaración para Doble Ahumada')
    .pressSequentially('sin cebolla', { delay: 90 });
  await writeNote(beto, 'Doble Ahumada', 'sin cebolla');
  await goTab(ana, 'Pedido');
  await pause(ana, 2200);

  // Cata pierde la conexión; Beto sigue agregando; al volver, Cata se resincroniza sola.
  await goTab(cata, 'Actividad');
  await pause(cata, 1200);
  await cata.getByRole('button', { name: 'Simular desconexión' }).click();
  await pause(cata, 1300);
  await tapAdd(beto, 'Gaseosa', 2, 400);
  await cata
    .getByTestId('connection')
    .filter({ hasText: 'Sincronizado' })
    .waitFor({ timeout: 15_000 });
  await pause(cata, 2600);

  // Ana cierra, revisa y envía.
  await goTab(beto, 'Pedido');
  await goTab(cata, 'Pedido');
  await pause(ana, 800);
  await ana.getByRole('button', { name: 'Cerrar pedido' }).click();
  await ana.getByRole('heading', { name: 'Resumen final' }).waitFor();
  await pause(ana, 3200);
  await ana.getByRole('button', { name: /^Enviar a/ }).click();
  await Promise.all(pages.map((p) => p.getByTestId('submitted').waitFor()));
  await pause(ana, 3500);

  // Cerrar los contextos termina de escribir los videos.
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();

  compose(await rawVideos());
  console.log(`\n✓ ${OUT_DIR}/demo.mp4 y ${OUT_DIR}/demo.gif (pedido ${code})`);
}

async function rawVideos(): Promise<string[]> {
  const raws: string[] = [];
  for (const [i] of PEOPLE.entries()) {
    const dir = path.join(RAW_DIR, String(i));
    const [file] = (await readdir(dir)).filter((f) => f.endsWith('.webm'));
    raws.push(path.join(dir, file!));
  }
  return raws;
}

/** Duración en segundos de un video (ffmpeg -i la informa por stderr). */
function duration(file: string): number {
  let info = '';
  try {
    execFileSync(ffmpegPath!, ['-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    info = String((err as { stderr?: Buffer }).stderr ?? '');
  }
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
  if (!m) throw new Error(`No pude leer la duración de ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Tres celulares lado a lado sobre fondo oscuro, con el nombre de cada uno arriba. */
function compose(raws: string[]) {
  const PHONE_W = VIDEO.width;
  const PHONE_H = VIDEO.height;
  const RADIUS = 26;
  const GAP = 32;
  const TOP = 84;
  const W = PHONE_W * 3 + GAP * 4;
  const H = PHONE_H + TOP + GAP;
  const font = fontFile();
  const run = (args: string[]) =>
    execFileSync(ffmpegPath!, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  // Máscara de esquinas redondeadas: se calcula una sola vez, no en cada cuadro.
  const mask = path.join(RAW_DIR, 'mask.png');
  const inCorner = `gt(abs(W/2-X),W/2-${RADIUS})*gt(abs(H/2-Y),H/2-${RADIUS})`;
  const outside = `gt(hypot(${RADIUS}-(W/2-abs(W/2-X)),${RADIUS}-(H/2-abs(H/2-Y))),${RADIUS})`;
  run([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=white:s=${PHONE_W}x${PHONE_H}`,
    '-frames:v',
    '1',
    '-vf',
    `format=gray,geq=lum='if(${inCorner}*${outside},0,255)'`,
    mask,
  ]);

  const parts = [`[3:v]format=gray,split=3[m0][m1][m2]`];
  raws.forEach((_, i) => {
    parts.push(
      `[${i}:v]fps=25,scale=${PHONE_W}:${PHONE_H}:flags=lanczos,format=rgba[s${i}]`,
      `[s${i}][m${i}]alphamerge[p${i}]`,
    );
  });
  let chain = `color=c=0x16161a:s=${W}x${H}:r=25[bg]`;
  let last = 'bg';
  raws.forEach((_, i) => {
    const x = GAP + i * (PHONE_W + GAP);
    chain += `;[${last}][p${i}]overlay=${x}:${TOP}:shortest=1[o${i}]`;
    last = `o${i}`;
    if (font) {
      chain +=
        `;[${last}]drawtext=fontfile='${font}':text='${PEOPLE[i]!.caption}':` +
        `fontcolor=white:fontsize=28:x=${x}+(${PHONE_W}-text_w)/2:y=${TOP / 2 - 14}[t${i}]`;
      last = `t${i}`;
    }
  });
  const filter = `${parts.join(';')};${chain};[${last}]format=yuv420p[out]`;

  // La máscara entra en loop infinito: la salida se corta en la duración del video más corto.
  const seconds = Math.min(...raws.map(duration));
  const inputs = [...raws.flatMap((r) => ['-i', r]), '-loop', '1', '-i', mask];
  run([
    '-y',
    ...inputs,
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-t',
    seconds.toFixed(2),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '21',
    '-movflags',
    '+faststart',
    path.join(OUT_DIR, 'demo.mp4'),
  ]);

  // GIF: menos fps y ancho, con paleta propia para que los colores de marca no se ensucien.
  const gifFilter =
    'fps=10,scale=1000:-1:flags=lanczos,split[a][b];' +
    '[a]palettegen=max_colors=128:stats_mode=diff[p];' +
    '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
  run([
    '-y',
    '-i',
    path.join(OUT_DIR, 'demo.mp4'),
    '-vf',
    gifFilter,
    path.join(OUT_DIR, 'demo.gif'),
  ]);
}

/** Fuente para los títulos (drawtext necesita un archivo; en Windows el ":" de la unidad va escapado). */
function fontFile(): string | null {
  const candidates =
    process.platform === 'win32'
      ? ['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf']
      : [
          '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
          '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        ];
  const found = candidates.find((c) => existsSync(c));
  return found ? found.replace(':', '\\:') : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
