import type { OrderSnapshot, PresenceState } from '@pedido/shared';
import { AnimatePresence, motion } from 'motion/react';
import type { FlashMap } from '@/lib/useOrderLive';
import { Avatar } from './Avatar';

/** Avatares chicos de quienes están en el pedido, y quién está eligiendo en este momento. */
export function PeopleRow({
  state,
  presence,
  me,
  flash,
}: {
  state: OrderSnapshot;
  presence: PresenceState;
  me: string;
  flash: FlashMap;
}) {
  const online = new Map(presence.participants.map((p) => [p.participantId, p.choosing]));
  const people = [...state.participants].sort((a, b) => Number(b.id === me) - Number(a.id === me));
  const choosing = people.filter((p) => p.id !== me && online.get(p.id) === true);

  return (
    <div className="flex items-center gap-3" data-testid="people">
      <ul className="flex items-center gap-2.5" aria-label="Personas en el pedido">
        <AnimatePresence initial={false}>
          {people.map((p) => (
            <motion.li
              key={p.id}
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: flash.has(p.id) ? [1, 1.18, 1] : 1 }}
              transition={{ duration: 0.35 }}
              className="flex items-center gap-1.5"
              title={p.id === state.order.hostParticipantId ? `${p.name} (armó el pedido)` : p.name}
            >
              <Avatar
                name={p.name}
                color={p.color}
                size={26}
                online={p.id === me || online.has(p.id)}
              />
              <span className="text-[13px] font-medium">{p.id === me ? 'Vos' : p.name}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <AnimatePresence>
        {choosing.length > 0 && (
          <motion.span
            key="choosing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="ml-auto truncate text-xs text-muted-foreground"
          >
            {choosing.map((p) => p.name).join(', ')} {choosing.length === 1 ? 'está' : 'están'}{' '}
            eligiendo…
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
