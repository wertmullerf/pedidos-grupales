import { totalsByParticipant } from '@pedido/client';
import type { OrderSnapshot } from '@pedido/shared';
import { formatMoney } from '../../lib/format';
import { Avatar } from './Avatar';
import styles from './order.module.css';

/** Quién pidió qué y cuánto paga cada uno. */
export function FinalSummary({ state, me }: { state: OrderSnapshot; me: string }) {
  const totals = totalsByParticipant(state);
  return (
    <div className={styles.final} data-testid="final-summary">
      {state.participants.map((p) => {
        const items = state.items.filter((i) => i.participantId === p.id);
        return (
          <section key={p.id} className={styles.finalPerson}>
            <header className={styles.finalHeader}>
              <Avatar name={p.name} color={p.color} size={28} />
              <span className={styles.finalName}>{p.id === me ? `${p.name} (vos)` : p.name}</span>
              <span className={styles.finalPays}>
                paga <strong>{formatMoney(totals.get(p.id) ?? 0)}</strong>
              </span>
            </header>
            {items.length === 0 ? (
              <p className={styles.finalEmpty}>No pidió nada</p>
            ) : (
              <ul className={styles.finalLines}>
                {items.map((i) => (
                  <li key={i.id}>
                    <span>
                      {i.quantity}× {i.name}
                      {i.notes && <em> · {i.notes}</em>}
                    </span>
                    <span>{formatMoney(i.quantity * i.unitPriceCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <div className={styles.finalTotal}>
        <span>Total</span>
        <strong data-testid="final-total">{formatMoney(state.totalCents)}</strong>
      </div>
    </div>
  );
}
