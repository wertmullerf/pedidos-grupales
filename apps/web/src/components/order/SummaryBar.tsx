import type { OrderStatus } from '@pedido/shared';
import { formatMoney } from '../../lib/format';
import styles from './order.module.css';

export function SummaryBar({
  totalCents,
  mineCents,
  itemCount,
  isHost,
  status,
  busy,
  onLock,
  onReview,
  onViewOrder,
}: {
  totalCents: number;
  mineCents: number;
  itemCount: number;
  isHost: boolean;
  status: OrderStatus;
  busy: boolean;
  onLock: () => void;
  onReview: () => void;
  onViewOrder?: () => void;
}) {
  return (
    <div className={styles.summaryBar} data-testid="summary">
      <div className={styles.summaryText}>
        <span className={styles.summaryTotal}>
          Total del grupo <strong data-testid="group-total">{formatMoney(totalCents)}</strong>
        </span>
        <span className={styles.summaryMine}>
          Vos pagás <strong data-testid="my-total">{formatMoney(mineCents)}</strong>
        </span>
      </div>
      {isHost && status === 'open' && (
        <button
          className="btn btn-primary"
          onClick={onLock}
          disabled={busy || itemCount === 0}
          title={itemCount === 0 ? 'Agreguen algo primero' : undefined}
        >
          Cerrar pedido
        </button>
      )}
      {isHost && status === 'locked' && (
        <button className="btn btn-primary" onClick={onReview}>
          Ver resumen
        </button>
      )}
      {!isHost && onViewOrder && (
        <button className="btn btn-secondary" onClick={onViewOrder}>
          Ver pedido · {itemCount}
        </button>
      )}
    </div>
  );
}
