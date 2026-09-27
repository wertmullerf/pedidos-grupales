import type { OrderSession } from '@pedido/client';
import type { MenuItem, OrderSnapshot } from '@pedido/shared';
import { categoryEmoji, categoryRank, formatMoney } from '../../lib/format';
import { Stepper } from './Stepper';
import styles from './order.module.css';

export function MenuPanel({
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
  if (!menu) return <div className={styles.panelLoading} aria-busy="true" />;

  const categories = [...new Set(menu.map((m) => m.category))].sort(
    (a, b) => categoryRank(a) - categoryRank(b),
  );

  /** Mi línea "simple" de ese producto (sin aclaraciones): el + del menú suma ahí. */
  const plainLine = (menuItemId: string) =>
    state.items.find((i) => i.participantId === me && i.menuItemId === menuItemId && !i.notes);

  function add(item: MenuItem) {
    onChoosing();
    const line = plainLine(item.id);
    if (line) session.increment(line.id, 1);
    else session.addItem({ id: item.id, name: item.name, priceCents: item.priceCents });
  }

  return (
    <div className={styles.menu} onPointerDown={onChoosing} onScroll={onChoosing}>
      {categories.map((category) => (
        <section key={category} className={styles.menuSection}>
          <h3 className={styles.menuCategory}>{category}</h3>
          <div className={styles.menuGrid}>
            {menu
              .filter((m) => m.category === category)
              .map((item) => {
                const line = plainLine(item.id);
                return (
                  <article
                    key={item.id}
                    className={styles.menuCard}
                    data-unavailable={!item.available || undefined}
                    data-testid="menu-item"
                    data-name={item.name}
                  >
                    <div className={styles.menuThumb} aria-hidden>
                      {categoryEmoji(item.category)}
                    </div>
                    <div className={styles.menuInfo}>
                      <h4 className={styles.menuName}>{item.name}</h4>
                      <p className={styles.menuDesc}>{item.description}</p>
                      <div className={styles.menuFooter}>
                        <span className={styles.price}>{formatMoney(item.priceCents)}</span>
                        {!item.available ? (
                          <span className={styles.soldOut}>Sin stock</span>
                        ) : line ? (
                          <Stepper
                            label={item.name}
                            quantity={line.quantity}
                            disabled={!editable}
                            onChange={(delta) => {
                              onChoosing();
                              session.increment(line.id, delta);
                            }}
                          />
                        ) : (
                          <button
                            className={styles.addButton}
                            onClick={() => add(item)}
                            disabled={!editable}
                            aria-label={`Agregar ${item.name}`}
                          >
                            <span aria-hidden>+</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
