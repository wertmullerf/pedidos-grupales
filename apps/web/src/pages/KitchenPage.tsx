import { KitchenConnection } from '@pedido/client';
import type { Branch, KitchenOrder } from '@pedido/shared';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { cn } from 'cn';
import { Wordmark } from '@/components/Wordmark';
import { api } from '@/lib/api';
import { formatMoney, formatTime, plural } from '@/lib/format';
import { useTenant } from '@/lib/tenant';

/** Vista de sucursal (solo modo debug): los pedidos grupales enviados llegan en vivo. Muestra que el flujo termina en el local. */
export function KitchenPage() {
  const tenant = useTenant();
  const branchId = useParams().branchId ?? '';
  const [branch, setBranch] = useState<Branch | null>(null);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .branches(tenant.slug)
      .then((list) => setBranch(list.find((b) => b.id === branchId) ?? null));
    const load = () =>
      api
        .kitchenOrders(tenant.slug, branchId)
        .then(setOrders, () => setError('Sucursal inexistente'));
    load();

    const conn = new KitchenConnection({
      url: window.location.origin,
      tenantSlug: tenant.slug,
      branchId,
    });
    const offOrder = conn.onOrder((order) => {
      setOrders((list) => [order, ...list.filter((o) => o.code !== order.code)]);
      setFresh((s) => new Set(s).add(order.code));
      setTimeout(
        () =>
          setFresh((s) => {
            const next = new Set(s);
            next.delete(order.code);
            return next;
          }),
        6000,
      );
    });
    const offConnect = conn.onConnect(() => {
      setOnline(true);
      void load();
    });
    const offDisconnect = conn.onDisconnect(() => setOnline(false));
    return () => {
      offOrder();
      offConnect();
      offDisconnect();
      conn.close();
    };
  }, [tenant.slug, branchId]);

  return (
    <main className="min-h-dvh bg-neutral-100 pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b bg-background px-6 py-4">
        <Wordmark name={tenant.name} className="text-xl" />
        <div className="flex-1 border-l pl-4 leading-tight">
          <h1 className="font-semibold">Cocina · Sucursal {branch?.name ?? ''}</h1>
          <p className="text-xs text-muted-foreground">Pedidos grupales recibidos</p>
        </div>
        <span
          className={cn(
            'text-xs font-medium',
            online ? 'text-emerald-600' : 'text-muted-foreground',
          )}
        >
          {online ? 'En vivo' : 'Conectando…'}
        </span>
      </header>

      {error ? (
        <p className="p-10 text-center">{error}</p>
      ) : orders.length === 0 ? (
        <div className="grid justify-items-center gap-2 p-16 text-center">
          <p className="font-semibold">Todavía no llegó ningún pedido.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Cuando un grupo envíe su pedido a esta sucursal, aparece acá al instante.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] items-start gap-4 p-6">
          {orders.map((order) => (
            <article
              key={order.code}
              className={cn(
                'rounded-lg border bg-background p-4',
                fresh.has(order.code) && 'border-primary',
              )}
              data-fresh={fresh.has(order.code) || undefined}
              data-testid="kitchen-ticket"
            >
              <header className="flex items-center gap-2 border-b border-dashed pb-2">
                <span className="text-lg font-bold tracking-wider">#{order.code}</span>
                {fresh.has(order.code) && (
                  <span className="rounded-sm bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                    Nuevo
                  </span>
                )}
                <time className="ml-auto text-sm text-muted-foreground">
                  {formatTime(order.submittedAt)}
                </time>
              </header>
              {order.participants.map((p) => {
                const items = order.items.filter((i) => i.participantId === p.id);
                if (items.length === 0) return null;
                return (
                  <section key={p.id} className="pt-3">
                    <h2 className="text-xs font-bold uppercase" style={{ color: p.color }}>
                      {p.name}
                    </h2>
                    <ul className="mt-1 space-y-1">
                      {items.map((i) => (
                        <li key={i.id}>
                          <strong>{i.quantity}×</strong> {i.name}
                          {i.notes && (
                            <span className="block pl-6 text-sm font-semibold">{i.notes}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              <footer className="mt-3 flex justify-between border-t border-dashed pt-2 text-sm text-muted-foreground">
                <span>
                  {plural(
                    order.items.reduce((n, i) => n + i.quantity, 0),
                    'producto',
                    'productos',
                  )}
                </span>
                <strong className="text-foreground">{formatMoney(order.totalCents)}</strong>
              </footer>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
