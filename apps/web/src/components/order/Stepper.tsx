import styles from './order.module.css';

/** Control − cantidad +. Manda deltas (nunca valores absolutos). */
export function Stepper({
  label,
  quantity,
  disabled,
  onChange,
}: {
  label: string;
  quantity: number;
  disabled?: boolean;
  onChange: (delta: number) => void;
}) {
  return (
    <div className={styles.stepper} data-testid="stepper">
      <button
        onClick={() => onChange(-1)}
        disabled={disabled}
        aria-label={quantity === 1 ? `Quitar ${label}` : `Restar ${label}`}
      >
        {quantity === 1 ? <TrashIcon /> : '−'}
      </button>
      <span className={styles.stepperQty} aria-live="polite" aria-label={`${quantity} ${label}`}>
        {quantity}
      </span>
      <button onClick={() => onChange(1)} disabled={disabled} aria-label={`Sumar ${label}`}>
        +
      </button>
    </div>
  );
}

export function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
