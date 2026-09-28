import type { MenuItem } from '@pedido/shared';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/lib/format';

/** Detalle de producto (bottom sheet): cantidad y aclaración antes de agregar. */
export function ProductSheet({
  item,
  editable,
  onOpenChange,
  onAdd,
}: {
  item: MenuItem | null;
  editable: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: MenuItem, quantity: number, notes: string) => void;
}) {
  return (
    <Drawer open={item !== null} onOpenChange={onOpenChange}>
      <DrawerContent>
        {/* key: cada producto arranca con su propio estado (cantidad 1, sin aclaración). */}
        {item && <ProductForm key={item.id} item={item} editable={editable} onAdd={onAdd} />}
      </DrawerContent>
    </Drawer>
  );
}

function ProductForm({
  item,
  editable,
  onAdd,
}: {
  item: MenuItem;
  editable: boolean;
  onAdd: (item: MenuItem, quantity: number, notes: string) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  return (
    <>
      <div className="overflow-y-auto">
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt=""
            className="mx-5 mt-3 aspect-[4/3] w-[calc(100%-2.5rem)] rounded-lg object-cover"
          />
        )}
        <DrawerHeader>
          <DrawerTitle>{item.name}</DrawerTitle>
          <DrawerDescription>{item.description}</DrawerDescription>
          <p className="tabular mt-2 text-lg font-semibold">{formatMoney(item.priceCents)}</p>
        </DrawerHeader>
        <div className="space-y-2 px-5 pb-4">
          <label htmlFor="notes" className="text-sm font-medium">
            Aclaraciones
          </label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: sin cebolla"
            maxLength={140}
            className="min-h-20 resize-none rounded-lg text-base"
          />
        </div>
      </div>
      <DrawerFooter className="flex-row items-center gap-3">
        <div className="flex h-12 items-center rounded-lg border">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="grid h-12 w-11 place-items-center"
            aria-label="Menos"
          >
            <Minus className="size-4" />
          </button>
          <span className="tabular w-6 text-center font-semibold">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(20, q + 1))}
            className="grid h-12 w-11 place-items-center"
            aria-label="Más"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <Button
          size="lg"
          className="flex-1"
          disabled={!editable}
          onClick={() => onAdd(item, quantity, notes.trim())}
        >
          Agregar · {formatMoney(item.priceCents * quantity)}
        </Button>
      </DrawerFooter>
    </>
  );
}
