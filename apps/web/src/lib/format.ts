const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

/** Precios en pesos, formato argentino: $ 9.500 */
export const formatMoney = (cents: number) => money.format(Math.round(cents / 100));

const time = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' });
export const formatTime = (date: Date | string | number) => time.format(new Date(date));

export const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

/** Ilustración por categoría para las tarjetas del menú. */
export function categoryEmoji(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('bebida')) return '🥤';
  if (c.includes('acompa') || c.includes('extra')) return '🍟';
  return '🍔';
}

/** Orden natural de un menú de hamburguesería: principales, acompañamientos, bebidas. */
export function categoryRank(category: string): number {
  return ['🍔', '🍟', '🥤'].indexOf(categoryEmoji(category));
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}
