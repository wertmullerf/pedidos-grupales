import { totalsByParticipant } from '@pedido/client';
import type { MenuItem, OrderSnapshot } from '@pedido/shared';
import { useEffect, useState } from 'react';
import { BrandMark } from '../components/BrandMark';
import { ActivityPanel } from '../components/order/ActivityPanel';
import { ConnectionBadge } from '../components/order/ConnectionBadge';
import { FinalSummary } from '../components/order/FinalSummary';
import { GroupOrderPanel } from '../components/order/GroupOrderPanel';
import { MenuPanel } from '../components/order/MenuPanel';
import { PeopleStrip } from '../components/order/PeopleStrip';
import { SummaryBar } from '../components/order/SummaryBar';
import { Toasts } from '../components/order/Toasts';
import styles from '../components/order/order.module.css';
import { api } from '../lib/api';
import type { Identity } from '../lib/identity';
import { rejectionMessage } from '../lib/messages';
import { useTenant } from '../lib/tenant';
import { useOrderLive } from '../lib/useOrderLive';

type Tab = 'menu' | 'order' | 'activity';

export function OrderPage({
  code,
  identity,
  onInvalidToken,
}: {
  code: string;
  identity: Identity;
  onInvalidToken: () => void;
}) {
  const tenant = useTenant();
  const live = useOrderLive(tenant.slug, identity, onInvalidToken);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [tab, setTab] = useState<Tab>('menu');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.menu(tenant.slug).then(setMenu);
  }, [tenant.slug]);

  const { state, session } = live;
  if (!state || !session) {
    return (
      <div className={styles.loadingScreen} aria-busy="true">
        <BrandMark tenant={tenant} size={56} />
        <span>Conectando al pedido {code}…</span>
      </div>
    );
  }

  const me = identity.participantId;
  const isHost = state.order.hostParticipantId === me;
  const status = state.order.status;
  const editable = status === 'open';
  const mine = totalsByParticipant(state).get(me) ?? 0;
  const itemCount = state.items.reduce((n, i) => n + i.quantity, 0);

  if (status === 'submitted') return <SubmittedScreen state={state} me={me} />;

  async function changeStatus(command: 'order:lock' | 'order:unlock' | 'order:submit') {
    if (!session) return;
    setBusy(true);
    const ack = await session.setStatus(command);
    setBusy(false);
    if (!ack.ok) live.toast(rejectionMessage(ack.error.code, command), 'warn');
    else if (command === 'order:lock') setReviewOpen(true);
    else if (command === 'order:unlock') setReviewOpen(false);
  }

  async function share() {
    const url = `${window.location.origin}/t/${tenant.slug}/o/${code}`;
    const text = `Sumate a nuestro pedido de ${tenant.name}: cada uno elige lo suyo.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Pedido grupal ${code}`, text, url });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      live.toast('Link copiado. Pasalo por el grupo 🙌', 'ok');
    } catch {
      live.toast(`Compartí este link: ${url}`, 'info');
    }
  }

  return (
    <div className={styles.page} data-tab={tab}>
      <div className={styles.topBar}>
        <BrandMark tenant={tenant} size={40} />
        <div className={styles.headerTitle}>
          <span className={styles.tenantName}>{tenant.name}</span>
          <span className={styles.branchName}>{state.branch.name}</span>
        </div>
        <ConnectionBadge status={live.status} justSynced={live.justSynced} />
      </div>
      <header className={styles.header}>
        <div className={styles.codeBar}>
          <div>
            <span className={styles.codeLabel}>Pedido grupal</span>
            <span className={styles.code} data-testid="order-code">
              {code}
            </span>
          </div>
          <span className={styles.youAre}>
            Sos <strong>{identity.name}</strong>
          </span>
          <button className={styles.shareButton} onClick={share}>
            <ShareIcon /> Compartir
          </button>
        </div>
        <PeopleStrip state={state} presence={live.presence} me={me} flash={live.flash} />
      </header>
      <nav className={styles.tabs} role="tablist" aria-label="Secciones">
        {(
          [
            ['menu', 'Menú'],
            ['order', `Pedido · ${itemCount}`],
            ['activity', 'Actividad'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={styles.tab}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className={styles.columns}>
        <section className={`${styles.column} ${styles.colMenu}`} aria-label="Menú">
          <h2 className={styles.columnTitle}>Menú</h2>
          <MenuPanel
            menu={menu}
            state={state}
            me={me}
            session={session}
            editable={editable}
            onChoosing={live.markChoosing}
          />
        </section>
        <section className={`${styles.column} ${styles.colOrder}`} aria-label="Pedido del grupo">
          <h2 className={styles.columnTitle}>Pedido del grupo</h2>
          <GroupOrderPanel
            state={state}
            me={me}
            session={session}
            editable={editable}
            flash={live.flash}
            onGoToMenu={() => setTab('menu')}
          />
        </section>
        <aside className={`${styles.column} ${styles.colActivity}`} aria-label="Actividad">
          <ActivityPanel
            entries={live.activity}
            state={state}
            me={me}
            status={live.status}
            onSimulateDisconnect={() => live.simulateDisconnect()}
          />
        </aside>
      </main>

      <SummaryBar
        totalCents={state.totalCents}
        mineCents={mine}
        itemCount={itemCount}
        isHost={isHost}
        status={status}
        busy={busy}
        onLock={() => changeStatus('order:lock')}
        onReview={() => setReviewOpen(true)}
        onViewOrder={tab === 'menu' ? () => setTab('order') : undefined}
      />

      {isHost && status === 'locked' && reviewOpen && (
        <div className={styles.sheetBackdrop} onClick={() => setReviewOpen(false)}>
          <div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.sheetHandle} aria-hidden />
            <h2 id="review-title" className={styles.sheetTitle}>
              Resumen final
            </h2>
            <p className={styles.sheetSubtitle}>
              Pedido cerrado: nadie más puede cambiar nada. Revisalo antes de enviarlo.
            </p>
            <FinalSummary state={state} me={me} />
            <div className={styles.sheetActions}>
              <button
                className="btn btn-primary btn-block"
                onClick={() => changeStatus('order:submit')}
                disabled={busy}
              >
                Enviar a {state.branch.name}
              </button>
              <button
                className="btn btn-ghost btn-block"
                onClick={() => changeStatus('order:unlock')}
                disabled={busy}
              >
                Reabrir para cambios
              </button>
            </div>
          </div>
        </div>
      )}

      <Toasts toasts={live.toasts} />
    </div>
  );
}

function SubmittedScreen({ state, me }: { state: OrderSnapshot; me: string }) {
  const tenant = useTenant();
  return (
    <main className={styles.submitted} data-testid="submitted">
      <div className={styles.submittedHero}>
        <div className={styles.check} aria-hidden>
          ✓
        </div>
        <h1>¡Pedido enviado!</h1>
        <p>
          Ya lo está recibiendo {state.branch.name}. Pedido <strong>{state.order.code}</strong>
        </p>
      </div>
      <div className={`card ${styles.submittedCard}`}>
        <FinalSummary state={state} me={me} />
      </div>
      <a className="btn btn-secondary" href={`/t/${tenant.slug}`}>
        Armar otro pedido
      </a>
    </main>
  );
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v12M12 3l-4 4M12 3l4 4M5 12v6a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
