import { KitchenConnection } from '@pedido/client';
import type { Branch, KitchenOrder } from '@pedido/shared';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { api } from '../lib/api';
import { formatMoney, formatTime, plural } from '../lib/format';
import { useTenant } from '../lib/tenant';
import styles from './KitchenPage.module.css';

/** Vista de sucursal: los pedidos grupales enviados llegan en vivo. Muestra que el flujo termina en el local. */
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
    <main className={styles.page}>
      <header className={styles.header}>
        <BrandMark tenant={tenant} size={44} />
        <div className={styles.headerText}>
          <h1>Cocina · {branch?.name ?? tenant.name}</h1>
          <p>Pedidos grupales recibidos</p>
        </div>
        <span className={styles.live} data-online={online || undefined}>
          {online ? 'En vivo' : 'Conectando…'}
        </span>
      </header>

      {error ? (
        <p className={styles.empty}>{error}</p>
      ) : orders.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden>🧑‍🍳</span>
          <p>Todavía no llegó ningún pedido.</p>
          <p className={styles.hint}>
            Cuando un grupo envíe su pedido a esta sucursal, aparece acá al instante.
          </p>
        </div>
      ) : (
        <div className={styles.tickets}>
          {orders.map((order) => (
            <article
              key={order.code}
              className={styles.ticket}
              data-fresh={fresh.has(order.code) || undefined}
              data-testid="kitchen-ticket"
            >
              <header className={styles.ticketHeader}>
                <span className={styles.ticketCode}>#{order.code}</span>
                {fresh.has(order.code) && <span className={styles.newTag}>Nuevo</span>}
                <time>{formatTime(order.submittedAt)}</time>
              </header>
              {order.participants.map((p) => {
                const items = order.items.filter((i) => i.participantId === p.id);
                if (items.length === 0) return null;
                return (
                  <section key={p.id} className={styles.person}>
                    <h2 style={{ color: p.color }}>{p.name}</h2>
                    <ul>
                      {items.map((i) => (
                        <li key={i.id}>
                          <strong>{i.quantity}×</strong> {i.name}
                          {i.notes && <span className={styles.note}>{i.notes}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              <footer className={styles.ticketFooter}>
                <span>
                  {plural(
                    order.items.reduce((n, i) => n + i.quantity, 0),
                    'producto',
                    'productos',
                  )}
                </span>
                <strong>{formatMoney(order.totalCents)}</strong>
              </footer>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
