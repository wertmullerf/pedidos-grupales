// Simulación de carga: N bots se unen a un pedido y agregan/quitan ítems al azar en paralelo.
// Al final verifica que todos los clientes terminaron con exactamente el mismo estado que el server.
//
//   npm run simulate                         # pedido nuevo en hamburgueseria-test, 6 bots, 20 s
//   npm run simulate -- --code ABC234        # sobre un pedido abierto en el navegador (para verlo en vivo)
//   npm run simulate -- --bots 10 --seconds 30 --tenant smashlab
//   npm run simulate -- --urls http://localhost:3001,http://localhost:3002   # directo a cada instancia
import { parseArgs } from 'node:util';
import { OrderConnection, OrderSession } from '@pedido/client';
import type { JoinResponse, MenuItem, OrderSnapshot } from '@pedido/shared';

const { values: args } = parseArgs({
  options: {
    tenant: { type: 'string', default: 'hamburgueseria-test' },
    code: { type: 'string' },
    bots: { type: 'string', default: '6' },
    seconds: { type: 'string', default: '20' },
    url: { type: 'string', default: 'http://localhost:8080' },
    urls: { type: 'string' },
  },
});

const API = args.url!;
const socketUrls = (args.urls ?? API).split(',');
const tenant = args.tenant!;
// El join por REST tiene rate limit por IP (20/min): más bots que eso se rechazarían.
const botCount = Math.min(Number(args.bots), 15);
const seconds = Number(args.seconds);

const NAMES = [
  'Lu',
  'Tomi',
  'Sofi',
  'Nacho',
  'Juli',
  'Maxi',
  'Caro',
  'Fede',
  'Agus',
  'Vale',
  'Santi',
  'Mica',
  'Leo',
  'Pau',
  'Gonza',
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api/t/${tenant}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok)
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;

interface Bot {
  name: string;
  conn: OrderConnection;
  session: OrderSession;
  me: string;
  ops: number;
  rejected: Map<string, number>;
}

async function main() {
  const menu = (await api<MenuItem[]>('/menu')).filter((m) => m.available);
  let code = args.code?.toUpperCase();
  let observerToken: string | null = null;

  if (!code) {
    const branches = await api<{ id: string; isOpen: boolean }[]>('/branches');
    const created = await api<JoinResponse>('/orders', {
      method: 'POST',
      body: JSON.stringify({ branchId: branches.find((b) => b.isOpen)!.id, name: 'Anfitrión' }),
    });
    code = created.code;
    observerToken = created.token;
  }
  console.log(`\nPedido ${code} en ${tenant} · ${botCount} bots · ${seconds} s`);
  console.log(`Miralo en vivo: http://localhost:5173/t/${tenant}/o/${code}\n`);

  // Los bots se unen y conectan (repartidos entre las URLs de socket, si hay varias).
  const bots: Bot[] = [];
  for (let i = 0; i < botCount; i++) {
    const name = `${NAMES[i % NAMES.length]} (bot)`;
    const joined = await api<JoinResponse>(`/orders/${code}/join`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    observerToken ??= joined.token;
    const conn = new OrderConnection({
      url: socketUrls[i % socketUrls.length]!,
      tenantSlug: tenant,
      token: joined.token,
    });
    const session = new OrderSession(conn, joined.participant.id);
    const bot: Bot = {
      name,
      conn,
      session,
      me: joined.participant.id,
      ops: 0,
      rejected: new Map(),
    };
    session.onReject((r) => bot.rejected.set(r.code, (bot.rejected.get(r.code) ?? 0) + 1));
    await conn.connect();
    bots.push(bot);
  }

  // Cada bot actúa al azar, como una persona apurada tocando el celular.
  const deadline = Date.now() + seconds * 1000;
  const progress = setInterval(() => {
    const total = bots.reduce((n, b) => n + b.ops, 0);
    const version = bots[0]!.conn.store.version;
    process.stdout.write(`\r  operaciones: ${total} · versión del pedido: ${version}   `);
  }, 250);

  await Promise.all(
    bots.map(async (bot) => {
      while (Date.now() < deadline) {
        const mine = (bot.session.state?.items ?? []).filter((i) => i.participantId === bot.me);
        const roll = Math.random();
        if (mine.length === 0 || roll < 0.4) {
          const item = pick(menu);
          bot.session.addItem({ id: item.id, name: item.name, priceCents: item.priceCents });
        } else if (roll < 0.8) {
          // Ráfagas de toques: el debounce las agrupa en un solo increment.
          const line = pick(mine);
          const taps = 1 + Math.floor(Math.random() * 4);
          const dir = Math.random() < 0.7 ? 1 : -1;
          for (let t = 0; t < taps; t++) bot.session.increment(line.id, dir);
        } else if (roll < 0.9) {
          bot.session.remove(pick(mine).id);
        } else {
          bot.session.setNotes(pick(mine).id, pick(['sin cebolla', 'bien cocida', 'sin sal', '']));
        }
        bot.ops++;
        await sleep(150 + Math.random() * 750);
      }
    }),
  );
  clearInterval(progress);

  // Mandamos lo que quede en el debounce y esperamos a que todo se confirme y propague.
  await Promise.all(bots.map((b) => b.session.flush()));
  const settleUntil = Date.now() + 15_000;
  while (bots.some((b) => b.session.hasPending) && Date.now() < settleUntil) await sleep(100);
  await sleep(1000);

  const server = await api<OrderSnapshot>(`/orders/${code}/snapshot`, {
    headers: { authorization: `Bearer ${observerToken}` },
  });
  const canonical = normalize(server);

  console.log('\n\nResultado:');
  let consistent = true;
  for (const bot of bots) {
    const same = JSON.stringify(normalize(bot.conn.store.state)) === JSON.stringify(canonical);
    consistent &&= same;
    const rejected = [...bot.rejected].map(([c, n]) => `${c}×${n}`).join(' ') || '—';
    console.log(
      `  ${same ? '✓' : '✗'} ${bot.name.padEnd(12)} ops ${String(bot.ops).padStart(3)} · ` +
        `v${bot.conn.store.version} · resyncs ${bot.conn.stats.resyncs} · rechazos ${rejected}`,
    );
  }
  console.log(
    `\n  Server: versión ${server.order.version}, ${server.items.length} líneas, ` +
      `total $${(server.totalCents / 100).toLocaleString('es-AR')}`,
  );
  console.log(
    consistent
      ? '  ✓ Todos los clientes terminaron con exactamente el mismo estado que el server.\n'
      : '  ✗ Hay clientes inconsistentes con el server.\n',
  );

  for (const bot of bots) {
    bot.session.dispose();
    bot.conn.close();
  }
  process.exit(consistent ? 0 : 1);
}

function normalize(s: OrderSnapshot | null) {
  if (!s) return null;
  return {
    version: s.order.version,
    status: s.order.status,
    participants: s.participants.map((p) => p.id).sort(),
    items: [...s.items]
      .map((i) => ({ id: i.id, q: i.quantity, n: i.notes, p: i.unitPriceCents }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    totalCents: s.totalCents,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
