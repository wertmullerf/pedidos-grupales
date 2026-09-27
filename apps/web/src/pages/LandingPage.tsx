import type { Branch, TenantInfo } from '@pedido/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { api } from '../lib/api';
import styles from './LandingPage.module.css';

/** Cadenas cargadas por el seed de la demo. */
const DEMO_TENANTS = ['brasaburg', 'smashlab'];

interface TenantCard {
  tenant: TenantInfo;
  branches: Branch[];
}

export function LandingPage() {
  const [cards, setCards] = useState<TenantCard[]>([]);

  useEffect(() => {
    document.title = 'Pedido Grupal en Tiempo Real';
    Promise.all(
      DEMO_TENANTS.map(async (slug) => ({
        tenant: await api.tenant(slug),
        branches: await api.branches(slug),
      })),
    ).then(setCards);
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <span className={styles.kicker}>Demo · multi-tenant · tiempo real</span>
        <h1>Pedido grupal en tiempo real</h1>
        <p>
          Varias personas arman un mismo pedido desde sus celulares y ven los cambios de todos al
          instante. El mismo sistema sirve a distintas cadenas, cada una con su marca.
        </p>
      </header>

      <section className={styles.cards}>
        {cards.map(({ tenant, branches }) => (
          <article
            key={tenant.slug}
            className={styles.card}
            style={{ '--brand': tenant.primaryColor } as React.CSSProperties}
          >
            <div className={styles.cardTop}>
              <BrandMark tenant={tenant} size={64} />
              <div>
                <h2>{tenant.name}</h2>
                <p>{branches.length} sucursales</p>
              </div>
            </div>
            <Link className="btn btn-primary btn-block" to={`/t/${tenant.slug}`}>
              Armar un pedido en {tenant.name}
            </Link>
            <div className={styles.kitchens}>
              <span>Ver la cocina:</span>
              {branches.map((b) => (
                <Link key={b.id} to={`/t/${tenant.slug}/branch/${b.id}/kitchen`}>
                  {b.name.replace(tenant.name, '').trim() || b.name}
                  {!b.isOpen && ' (cerrada)'}
                </Link>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className={styles.how}>
        <h2>Cómo probarlo</h2>
        <ol>
          <li>Creá un pedido en cualquiera de las cadenas.</li>
          <li>Abrí el link en otras pestañas (cada pestaña es una persona distinta).</li>
          <li>
            Agreguen cosas a la vez, cortá la conexión con “Simular desconexión” y mirá el resync.
          </li>
          <li>Cerrá y enviá el pedido: aparece en vivo en la cocina de la sucursal.</li>
        </ol>
      </section>
    </main>
  );
}
