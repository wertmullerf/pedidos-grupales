import { totalsByParticipant } from '@pedido/client';
import type { OrderSnapshot } from '@pedido/shared';
import { formatMoney } from '@/lib/format';
import { Avatar } from './Avatar';

/** Quién pidió qué y cuánto paga cada uno. */
export function FinalSummary({ state, me }: { state: OrderSnapshot; me: string }) {
  const totals = totalsByParticipant(state);
  return (
    <div data-testid="final-summary">
      <ul className="divide-y">
        {state.participants.map((p) => {
          const items = state.items.filter((i) => i.participantId === p.id);
          return (
            <li key={p.id} className="py-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={p.name} color={p.color} size={24} />
                <span className="flex-1 font-semibold">
                  {p.name}
                  {p.id === me && <span className="font-normal text-muted-foreground"> (vos)</span>}
                </span>
                <span className="text-sm text-muted-foreground">
                  paga{' '}
                  <span className="tabular text-base font-semibold text-foreground">
                    {formatMoney(totals.get(p.id) ?? 0)}
                  </span>
                </span>
              </div>
              {items.length === 0 ? (
                <p className="mt-1 ml-[34px] text-sm text-muted-foreground">No pidió nada</p>
              ) : (
                <ul className="mt-1.5 ml-[34px] space-y-1 text-sm">
                  {items.map((i) => (
                    <li key={i.id} className="flex justify-between gap-3">
                      <span>
                        {i.quantity}× {i.name}
                        {i.notes && <span className="text-muted-foreground"> · {i.notes}</span>}
                      </span>
                      <span className="tabular">{formatMoney(i.quantity * i.unitPriceCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-baseline justify-between border-t pt-3">
        <span className="font-semibold">Total</span>
        <span className="tabular text-xl font-bold" data-testid="final-total">
          {formatMoney(state.totalCents)}
        </span>
      </div>
    </div>
  );
}
