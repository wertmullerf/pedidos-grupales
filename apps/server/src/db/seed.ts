import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { config } from '../config.js';
import { createPool } from './pool.js';
import { withTransaction } from './tx.js';
import { uuidV5 } from './uuid.js';

// Datos 100% inventados. Los IDs son UUID v5 derivados de una clave estable (slug, nombre), así el
// seed es idempotente: correrlo de nuevo actualiza las filas en lugar de duplicarlas.

interface SeedMenuItem {
  category: string;
  name: string;
  description: string;
  price: number; // en pesos
  available?: boolean;
  /** Foto en apps/web/public/products (ver CREDITS.md). */
  imageUrl?: string;
}

interface SeedTenant {
  slug: string;
  name: string;
  primaryColor: string;
  /** null: la UI muestra el nombre como wordmark de texto. */
  logoUrl: string | null;
  branches: { name: string; address: string; isOpen: boolean }[];
  menu: SeedMenuItem[];
}

export const SEED_TENANTS: SeedTenant[] = [
  {
    // La cadena de la demo: es la única que aparece en la UI.
    slug: 'hamburgueseria-test',
    name: 'Hamburguesería Test',
    primaryColor: '#D93A26',
    logoUrl: null,
    branches: [
      { name: 'Palermo', address: 'Av. Inventada 1234, CABA', isOpen: true },
      { name: 'Caballito', address: 'Calle Ficticia 567, CABA', isOpen: true },
    ],
    menu: [
      {
        category: 'Hamburguesas',
        name: 'Clásica',
        description: 'Medallón a la parrilla, cheddar, lechuga y tomate',
        price: 9500,
        imageUrl: '/products/clasica.webp',
      },
      {
        category: 'Hamburguesas',
        name: 'Doble Ahumada',
        description: 'Doble medallón, panceta ahumada y barbacoa',
        price: 12500,
        imageUrl: '/products/doble-ahumada.webp',
      },
      {
        category: 'Hamburguesas',
        name: 'Veggie de Lentejas',
        description: 'Medallón de lentejas, rúcula y alioli',
        price: 9800,
        imageUrl: '/products/veggie-de-lentejas.webp',
      },
      {
        category: 'Acompañamientos',
        name: 'Papas rústicas',
        description: 'Con piel, romero y sal gruesa',
        price: 4200,
        imageUrl: '/products/papas-rusticas.webp',
      },
      {
        category: 'Acompañamientos',
        name: 'Aros de cebolla',
        description: 'Rebozados en cerveza',
        price: 4800,
        imageUrl: '/products/aros-de-cebolla.webp',
        available: false,
      },
      {
        category: 'Bebidas',
        name: 'Limonada de la casa',
        description: 'Menta y jengibre',
        price: 3200,
        imageUrl: '/products/limonada.webp',
      },
      {
        category: 'Bebidas',
        name: 'Gaseosa',
        description: 'Vaso de 500 ml con hielo',
        price: 2500,
        imageUrl: '/products/gaseosa.webp',
      },
    ],
  },
  {
    slug: 'smashlab',
    name: 'Smashlab',
    primaryColor: '#2B8A3E',
    logoUrl: null,
    branches: [
      { name: 'Smashlab Núñez', address: 'Pasaje Imaginario 89, CABA', isOpen: true },
      { name: 'Smashlab Belgrano', address: 'Av. de Prueba 2020, CABA', isOpen: false },
    ],
    menu: [
      {
        category: 'Smash',
        name: 'Smash Simple',
        description: 'Un smash patty, american cheese y pepinos',
        price: 8200,
      },
      {
        category: 'Smash',
        name: 'Smash Triple',
        description: 'Tres smash patties y salsa Lab',
        price: 13900,
      },
      {
        category: 'Smash',
        name: 'Smash de Pollo',
        description: 'Pollo crispy, coleslaw y miel picante',
        price: 10400,
      },
      {
        category: 'Extras',
        name: 'Papas Lab',
        description: 'Papas fritas con salsa Lab y verdeo',
        price: 5100,
      },
      { category: 'Extras', name: 'Nuggets x6', description: 'Con dip a elección', price: 4600 },
      { category: 'Bebidas', name: 'Milkshake de vainilla', description: '400 ml', price: 5500 },
      { category: 'Bebidas', name: 'Agua saborizada', description: '500 ml', price: 2200 },
    ],
  },
];

export async function seed(pool: pg.Pool): Promise<void> {
  await withTransaction(pool, async (client) => {
    for (const t of SEED_TENANTS) {
      const tenantId = uuidV5(`tenant:${t.slug}`);
      await client.query(
        `INSERT INTO tenants (id, slug, name, primary_color, logo_url)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
           SET slug = EXCLUDED.slug, name = EXCLUDED.name,
               primary_color = EXCLUDED.primary_color, logo_url = EXCLUDED.logo_url`,
        [tenantId, t.slug, t.name, t.primaryColor, t.logoUrl],
      );

      for (const b of t.branches) {
        await client.query(
          `INSERT INTO branches (id, tenant_id, name, address, is_open)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE
             SET address = EXCLUDED.address, is_open = EXCLUDED.is_open`,
          [uuidV5(`branch:${t.slug}:${b.name}`), tenantId, b.name, b.address, b.isOpen],
        );
      }

      for (const m of t.menu) {
        await client.query(
          `INSERT INTO menu_items
             (id, tenant_id, category, name, description, price_cents, available, image_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE
             SET category = EXCLUDED.category, description = EXCLUDED.description,
                 price_cents = EXCLUDED.price_cents, available = EXCLUDED.available,
                 image_url = EXCLUDED.image_url`,
          [
            uuidV5(`menu:${t.slug}:${m.name}`),
            tenantId,
            m.category,
            m.name,
            m.description,
            m.price * 100,
            m.available ?? true,
            m.imageUrl ?? null,
          ],
        );
      }
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const pool = createPool(config.DATABASE_URL);
  seed(pool)
    .then(() => console.log(`Seed aplicado: ${SEED_TENANTS.map((t) => t.slug).join(', ')}`))
    .finally(() => pool.end());
}
