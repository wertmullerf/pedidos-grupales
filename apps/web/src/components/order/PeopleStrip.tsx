import type { OrderSnapshot, PresenceState } from '@pedido/shared';
import { Avatar } from './Avatar';
import styles from './order.module.css';

export function PeopleStrip({
  state,
  presence,
  me,
  flash,
}: {
  state: OrderSnapshot;
  presence: PresenceState;
  me: string;
  flash: ReadonlySet<string>;
}) {
  const online = new Map(presence.participants.map((p) => [p.participantId, p.choosing]));
  // Yo primero; el resto en orden de llegada.
  const people = [...state.participants].sort((a, b) => Number(b.id === me) - Number(a.id === me));

  return (
    <ul className={styles.people} aria-label="Personas en el pedido" data-testid="people">
      {people.map((p) => {
        const isOnline = online.has(p.id) || p.id === me;
        const choosing = online.get(p.id) === true && p.id !== me;
        return (
          <li
            key={p.id}
            className={styles.person}
            data-flash={flash.has(p.id) || undefined}
            style={{ '--person': p.color } as React.CSSProperties}
          >
            <Avatar name={p.name} color={p.color} online={isOnline} />
            <span className={styles.personText}>
              <span className={styles.personName}>
                {p.id === me ? 'Vos' : p.name}
                {p.id === state.order.hostParticipantId && (
                  <span className={styles.hostTag} title="Armó el pedido">
                    host
                  </span>
                )}
              </span>
              <span className={styles.personStatus} data-choosing={choosing || undefined}>
                {choosing ? (
                  <>
                    eligiendo
                    <span className={styles.dots} aria-hidden />
                  </>
                ) : isOnline ? (
                  'en línea'
                ) : (
                  'desconectado'
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
