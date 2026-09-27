import type { Toast } from '../../lib/useOrderLive';
import styles from './order.module.css';

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className={styles.toasts} aria-live="assertive">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} data-tone={t.tone} role="alert">
          {t.text}
        </div>
      ))}
    </div>
  );
}
