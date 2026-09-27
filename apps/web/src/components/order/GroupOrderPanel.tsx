import { totalsByParticipant, type OrderSession } from '@pedido/client';
import type { OrderItem, OrderSnapshot } from '@pedido/shared';
import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../../lib/format';
import { Avatar } from './Avatar';
import { Stepper, TrashIcon } from './Stepper';
import styles from './order.module.css';

export function GroupOrderPanel({
  state,
  me,
  session,
  editable,
  flash,
  onGoToMenu,
}: {
  state: OrderSnapshot;
  me: string;
  session: OrderSession;
  editable: boolean;
  flash: ReadonlySet<string>;
  onGoToMenu?: () => void;
}) {
  const totals = totalsByParticipant(state);
  const myItems = state.items.filter((i) => i.participantId === me);
  const others = state.participants.filter((p) => p.id !== me);
  const meP = state.participants.find((p) => p.id === me);

  return (
    <div className={styles.group} data-testid="group-order">
      {state.order.status === 'locked' && (
        <div className={styles.lockedBanner} role="status">
          <span aria-hidden>🔒</span>
          {state.order.hostParticipantId === me
            ? 'Cerraste el pedido. Revisá el resumen y envialo a la sucursal.'
            : `${hostName(state)} cerró el pedido y está revisando el resumen.`}
        </div>
      )}

      <section
        className={`${styles.part} ${styles.myPart}`}
        style={{ '--person': meP?.color } as React.CSSProperties}
        data-testid="part"
        data-person={meP?.name}
      >
        <header className={styles.partHeader}>
          {meP && <Avatar name={meP.name} color={meP.color} size={30} />}
          <h3 className={styles.partTitle}>Tu parte</h3>
          <span className={styles.partTotal} data-testid="part-total">
            {formatMoney(totals.get(me) ?? 0)}
          </span>
        </header>
        {myItems.length === 0 ? (
          <div className={styles.empty}>
            <p>Todavía no agregaste nada.</p>
            {onGoToMenu && (
              <button className="btn btn-secondary" onClick={onGoToMenu}>
                Ver el menú
              </button>
            )}
          </div>
        ) : (
          <ul className={styles.lines}>
            {myItems.map((item) => (
              <MyLine key={item.id} item={item} session={session} editable={editable} />
            ))}
          </ul>
        )}
      </section>

      {others.map((p) => {
        const items = state.items.filter((i) => i.participantId === p.id);
        return (
          <section
            key={p.id}
            className={styles.part}
            style={{ '--person': p.color } as React.CSSProperties}
            data-flash={flash.has(p.id) || undefined}
            data-testid="part"
            data-person={p.name}
          >
            <header className={styles.partHeader}>
              <Avatar name={p.name} color={p.color} size={30} />
              <h3 className={styles.partTitle}>{p.name}</h3>
              <span className={styles.partTotal} data-testid="part-total">
                {formatMoney(totals.get(p.id) ?? 0)}
              </span>
            </header>
            {items.length === 0 ? (
              <p className={styles.emptyOther}>Todavía está mirando el menú…</p>
            ) : (
              <ul className={styles.lines}>
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={styles.line}
                    data-flash={flash.has(item.id) || undefined}
                    data-testid="line"
                  >
                    <span className={styles.lineQty}>{item.quantity}×</span>
                    <span className={styles.lineMain}>
                      <span className={styles.lineName}>{item.name}</span>
                      {item.notes && <span className={styles.lineNotes}>{item.notes}</span>}
                    </span>
                    <span className={styles.linePrice}>
                      {formatMoney(item.quantity * item.unitPriceCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MyLine({
  item,
  session,
  editable,
}: {
  item: OrderItem;
  session: OrderSession;
  editable: boolean;
}) {
  return (
    <li className={`${styles.line} ${styles.myLine}`} data-testid="line">
      <div className={styles.myLineTop}>
        <span className={styles.lineMain}>
          <span className={styles.lineName}>{item.name}</span>
          <span className={styles.lineUnit}>{formatMoney(item.unitPriceCents)} c/u</span>
        </span>
        <span className={styles.linePrice}>{formatMoney(item.quantity * item.unitPriceCents)}</span>
      </div>
      <div className={styles.myLineBottom}>
        <NotesInput item={item} session={session} disabled={!editable} />
        <Stepper
          label={item.name}
          quantity={item.quantity}
          disabled={!editable}
          onChange={(delta) => session.increment(item.id, delta)}
        />
        <button
          className={styles.iconButton}
          onClick={() => session.remove(item.id)}
          disabled={!editable}
          aria-label={`Eliminar ${item.name}`}
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}

/** Aclaraciones: se escriben localmente y se mandan al pausar de tipear o al salir del campo. */
function NotesInput({
  item,
  session,
  disabled,
}: {
  item: OrderItem;
  session: OrderSession;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (value.trim() !== item.notes) session.setNotes(item.id, value.trim());
  };

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <input
      className={styles.notes}
      value={draft ?? item.notes}
      placeholder="Aclaración"
      maxLength={140}
      disabled={disabled}
      aria-label={`Aclaración para ${item.name}`}
      onChange={(e) => {
        const value = e.target.value;
        setDraft(value);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(value), 800);
      }}
      onBlur={(e) => {
        commit(e.target.value);
        setDraft(null);
      }}
    />
  );
}

function hostName(state: OrderSnapshot) {
  return state.participants.find((p) => p.id === state.order.hostParticipantId)?.name ?? 'El host';
}
