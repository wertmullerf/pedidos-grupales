import type { OrderSession } from '@pedido/client';
import type { MenuItem, OrderSnapshot } from '@pedido/shared';
import { cn } from 'cn';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { categoryRank, formatMoney } from '@/lib/format';
import { ProductSheet } from './ProductSheet';

/**
 * Menú como en las apps de delivery: nombre, descripción y precio a la izquierda; foto cuadrada a
 * la derecha con un "+" chico encima. Tocar la fila abre el detalle; tocar "+" suma directo.
 */
export function MenuList({
  menu,
  state,
  me,
  session,
  editable,
  onChoosing,
}: {
  menu: MenuItem[] | null;
  state: OrderSnapshot;
  me: string;
  session: OrderSession;
  editable: boolean;
  onChoosing: () => void;
}) {
  const [detail, setDetail] = useState<MenuItem | null>(null);

  if (!menu) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  const categories = [...new Set(menu.map((m) => m.category))].sort(
    (a, b) => categoryRank(a) - categoryRank(b),
  );

  /** Mi línea "simple" de ese producto (sin aclaraciones): el "+" del menú suma ahí. */
  const plainLine = (menuItemId: string) =>
    state.items.find((i) => i.participantId === me && i.menuItemId === menuItemId && !i.notes);

  function quickAdd(item: MenuItem) {
    onChoosing();
    const line = plainLine(item.id);
    if (line) session.increment(line.id, 1);
    else session.addItem({ id: item.id, name: item.name, priceCents: item.priceCents });
  }

  return (
    <div onPointerDown={onChoosing}>
      {categories.map((category) => (
        <section key={category} className="mb-6">
          <h3 className="mb-1 text-lg font-bold tracking-tight">{category}</h3>
          <ul className="divide-y">
            {menu
              .filter((m) => m.category === category)
              .map((item) => {
                const line = plainLine(item.id);
                const disabled = !editable || !item.available;
                return (
                  <li
                    key={item.id}
                    data-testid="menu-item"
                    data-name={item.name}
                    className={cn('flex gap-4 py-4', !item.available && 'opacity-50')}
                  >
                    <button
                      type="button"
                      onClick={() => item.available && setDetail(item)}
                      disabled={!item.available}
                      className="min-w-0 flex-1 text-left"
                      aria-label={`Ver ${item.name}`}
                    >
                      <span className="block font-semibold">{item.name}</span>
                      <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
                        {item.description}
                      </span>
                      <span className="tabular mt-2 block text-[15px] font-medium">
                        {item.available ? formatMoney(item.priceCents) : 'Sin stock'}
                      </span>
                    </button>

                    <div className="relative size-24 shrink-0">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          loading="lazy"
                          className="size-24 rounded-lg bg-muted object-cover"
                        />
                      ) : (
                        <div className="size-24 rounded-lg bg-muted" />
                      )}
                      {item.available &&
                        (line ? (
                          <div className="absolute right-1.5 bottom-1.5 flex h-8 items-center rounded-md border bg-background shadow-sm">
                            <button
                              type="button"
                              onClick={() => {
                                onChoosing();
                                session.increment(line.id, -1);
                              }}
                              disabled={disabled}
                              aria-label={`Restar ${item.name}`}
                              className="grid h-8 w-7 place-items-center disabled:opacity-40"
                            >
                              <Minus className="size-3.5" />
                            </button>
                            <span className="tabular min-w-4 text-center text-sm font-semibold">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => quickAdd(item)}
                              disabled={disabled}
                              aria-label={`Sumar ${item.name}`}
                              className="grid h-8 w-7 place-items-center disabled:opacity-40"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => quickAdd(item)}
                            disabled={disabled}
                            aria-label={`Agregar ${item.name}`}
                            className="absolute right-1.5 bottom-1.5 grid size-8 place-items-center rounded-md border bg-background shadow-sm transition-transform active:scale-90 disabled:opacity-40"
                          >
                            <Plus className="size-4" />
                          </button>
                        ))}
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      <ProductSheet
        item={detail}
        editable={editable}
        onOpenChange={(open) => !open && setDetail(null)}
        onAdd={(item, quantity, notes) => {
          onChoosing();
          session.addItem(
            { id: item.id, name: item.name, priceCents: item.priceCents },
            { quantity, notes },
          );
          setDetail(null);
        }}
      />
    </div>
  );
}
