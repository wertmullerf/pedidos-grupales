import { totalsByParticipant, type OrderSession } from '@pedido/client';
import type { OrderItem, OrderSnapshot, Participant } from '@pedido/shared';
import { Lock, Minus, Plus, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import type { FlashMap } from '@/lib/useOrderLive';
import { Avatar } from './Avatar';

/** El pedido del grupo, por persona. Lo que cambia otra persona se resalta un instante. */
export function GroupOrder({
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
  flash: FlashMap;
  onGoToMenu?: () => void;
}) {
  const totals = totalsByParticipant(state);
  const people = [...state.participants].sort((a, b) => Number(b.id === me) - Number(a.id === me));
  const byId = new Map(state.participants.map((p) => [p.id, p]));
  const host = byId.get(state.order.hostParticipantId);

  return (
    <div className="space-y-6" data-testid="group-order">
      {state.order.status === 'locked' && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg bg-muted px-4 py-3 text-sm"
        >
          <Lock className="mt-0.5 size-4 shrink-0" />
          {host?.id === me
            ? 'Cerraste el pedido. Revisá el resumen y envialo a la sucursal.'
            : `${host?.name ?? 'El host'} cerró el pedido y está revisando el resumen.`}
        </div>
      )}

      {people.map((p) => {
        const mine = p.id === me;
        const items = state.items.filter((i) => i.participantId === p.id);
        return (
          <section key={p.id} data-testid="part" data-person={p.name}>
            <header className="flex items-center gap-2.5 pb-2">
              <Avatar name={p.name} color={p.color} size={24} />
              <h3 className="flex-1 font-semibold">{mine ? 'Tu parte' : p.name}</h3>
              <span className="tabular font-semibold" data-testid="part-total">
                {formatMoney(totals.get(p.id) ?? 0)}
              </span>
            </header>

            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground">
                {mine ? (
                  <div className="flex items-center justify-between gap-3">
                    Todavía no agregaste nada.
                    {onGoToMenu && (
                      <Button size="sm" variant="outline" onClick={onGoToMenu}>
                        Ver menú
                      </Button>
                    )}
                  </div>
                ) : (
                  'Todavía está mirando el menú…'
                )}
              </div>
            ) : (
              <ul className="border-t">
                <AnimatePresence initial={false}>
                  {items.map((item) => (
                    <motion.li
                      key={item.id}
                      layout
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: 'easeOut' }}
                      className="relative overflow-hidden border-b"
                      data-line-id={item.id}
                      data-testid="line"
                    >
                      <HighlightBackground flash={flash.get(item.id)} />
                      {mine ? (
                        <MyLine item={item} session={session} editable={editable} />
                      ) : (
                        <OtherLine
                          item={item}
                          flash={flash.get(item.id)}
                          who={byId.get(flash.get(item.id)?.by ?? '')}
                        />
                      )}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Fondo suave del color de acento que se desvanece en ~1 s cuando otra persona cambia la línea. */
function HighlightBackground({ flash }: { flash: { by: string; at: number } | undefined }) {
  if (!flash) return null;
  return (
    <motion.span
      key={`bg-${flash.at}`}
      aria-hidden
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 1, ease: 'easeOut' }}
      className="pointer-events-none absolute inset-0 bg-brand-tint"
    />
  );
}

function OtherLine({
  item,
  flash,
  who,
}: {
  item: OrderItem;
  flash: { by: string; at: number } | undefined;
  who: Participant | undefined;
}) {
  return (
    <div className="relative flex items-baseline gap-3 py-3">
      <span className="tabular w-6 shrink-0 font-semibold" data-testid="qty">
        {item.quantity}×
      </span>
      <span className="min-w-0 flex-1">
        <span className="block" data-testid="line-name">
          {item.name}
        </span>
        {item.notes && (
          <span className="block text-sm text-muted-foreground" data-testid="line-notes">
            {item.notes}
          </span>
        )}
      </span>
      {/* Lugar fijo para el avatar de quien hizo el cambio: aparece y se va sin mover nada. */}
      <span className="w-5 shrink-0 self-center" aria-hidden>
        {flash && who && (
          <motion.span
            key={`who-${flash.at}`}
            className="block"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], scale: 1 }}
            transition={{ duration: 1.2, times: [0, 0.12, 0.75, 1] }}
          >
            <Avatar name={who.name} color={who.color} size={20} />
          </motion.span>
        )}
      </span>
      <span className="tabular text-[15px]">
        {formatMoney(item.quantity * item.unitPriceCents)}
      </span>
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
    <div className="relative py-3">
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 font-medium" data-testid="line-name">
          {item.name}
        </span>
        <span className="tabular text-[15px]">
          {formatMoney(item.quantity * item.unitPriceCents)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <NotesInput item={item} session={session} disabled={!editable} />
        <div className="flex h-9 items-center rounded-md border">
          <button
            type="button"
            onClick={() => session.increment(item.id, -1)}
            disabled={!editable}
            aria-label={`Restar ${item.name}`}
            className="grid h-9 w-8 place-items-center disabled:opacity-40"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="tabular w-5 text-center text-sm font-semibold" data-testid="qty">
            {item.quantity}
          </span>
          <button
            type="button"
            onClick={() => session.increment(item.id, 1)}
            disabled={!editable}
            aria-label={`Sumar ${item.name}`}
            className="grid h-9 w-8 place-items-center disabled:opacity-40"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <Button
          size="icon-lg"
          variant="ghost"
          onClick={() => session.remove(item.id)}
          disabled={!editable}
          aria-label={`Eliminar ${item.name}`}
          className="size-9 text-muted-foreground"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
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
      value={draft ?? item.notes}
      placeholder="Aclaración"
      maxLength={140}
      disabled={disabled}
      aria-label={`Aclaración para ${item.name}`}
      className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-muted px-3 text-sm outline-none focus:border-input focus:bg-background disabled:opacity-60"
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
