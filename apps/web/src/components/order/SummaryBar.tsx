import type { OrderStatus } from '@pedido/shared';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';

/** Resumen siempre visible: total del grupo y cuánto pagás vos. */
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
    <div
      data-testid="summary"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 lg:px-6">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[13px] text-muted-foreground">
            Total del grupo{' '}
            <span className="tabular font-semibold text-foreground" data-testid="group-total">
              {formatMoney(totalCents)}
            </span>
          </p>
          <p className="text-lg font-semibold">
            Vos pagás{' '}
            <span className="tabular font-bold" data-testid="my-total">
              {formatMoney(mineCents)}
            </span>
          </p>
        </div>
        {isHost && status === 'open' && (
          <Button onClick={onLock} disabled={busy || itemCount === 0}>
            Cerrar pedido
          </Button>
        )}
        {isHost && status === 'locked' && <Button onClick={onReview}>Ver resumen</Button>}
        {!isHost && onViewOrder && (
          <Button variant="outline" onClick={onViewOrder}>
            Ver pedido · {itemCount}
          </Button>
        )}
      </div>
    </div>
  );
}
