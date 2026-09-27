import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { config } from '../config.js';
import { createPool } from './pool.js';

// Datos 100% inventados. Los IDs se derivan de md5(clave) para que el seed sea idempotente:
// correrlo de nuevo actualiza las filas en lugar de duplicarlas o romper pedidos existentes.

interface SeedMenuItem {
  category: string;
  name: string;
  description: string;
  price: number; // en pesos
  available?: boolean;
}

interface SeedTenant {
  slug: string;
  name: string;
  primaryColor: string;
  logoUrl: string;
  branches: { name: string; address: string; isOpen: boolean }[];
  menu: SeedMenuItem[];
}

export const SEED_TENANTS: SeedTenant[] = [
  {
    slug: 'brasaburg',
    name: 'Brasaburg',
    primaryColor: '#D9480F',
    logoUrl: '/logos/brasaburg.svg',
    branches: [
      { name: 'Brasaburg Palermo', address: 'Av. Inventada 1234, CABA', isOpen: true },
      { name: 'Brasaburg Caballito', address: 'Calle Ficticia 567, CABA', isOpen: true },
    ],
    menu: [
      {
        category: 'Hamburguesas',
        name: 'Brasa Clásica',
        description: 'Medallón a la parrilla, cheddar, lechuga y tomate',
        price: 9500,
      },
      {
        category: 'Hamburguesas',
        name: 'Doble Ahumada',
        description: 'Doble medallón, panceta ahumada y barbacoa',
        price: 12500,
      },
      {
        category: 'Hamburguesas',
        name: 'Veggie de Lentejas',
        description: 'Medallón de lentejas, rúcula y alioli',
        price: 9800,
      },
      {
        category: 'Acompañamientos',
        name: 'Papas rústicas',
        description: 'Con piel, romero y sal gruesa',
        price: 4200,
      },
      {
        category: 'Acompañamientos',
        name: 'Aros de cebolla',
        description: 'Rebozados en cerveza',
        price: 4800,
        available: false,
      },
      {
        category: 'Bebidas',
        name: 'Limonada de la casa',
        description: 'Menta y jengibre',
        price: 3200,
      },
      { category: 'Bebidas', name: 'Gaseosa', description: 'Lata 354 ml', price: 2500 },
    ],
  },
  {
    slug: 'smashlab',
    name: 'Smashlab',
    primaryColor: '#2B8A3E',
    logoUrl: '/logos/smashlab.svg',
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of SEED_TENANTS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO tenants (id, slug, name, primary_color, logo_url)
         VALUES (md5($1)::uuid, $1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE
           SET name = EXCLUDED.name, primary_color = EXCLUDED.primary_color, logo_url = EXCLUDED.logo_url
         RETURNING id`,
        [t.slug, t.name, t.primaryColor, t.logoUrl],
      );
      const tenantId = rows[0]!.id;

      for (const b of t.branches) {
        await client.query(
          `INSERT INTO branches (id, tenant_id, name, address, is_open)
           VALUES (md5($1::text || ':branch:' || $2)::uuid, $1::uuid, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE
             SET address = EXCLUDED.address, is_open = EXCLUDED.is_open`,
          [tenantId, b.name, b.address, b.isOpen],
        );
      }

      for (const m of t.menu) {
        await client.query(
          `INSERT INTO menu_items (id, tenant_id, category, name, description, price_cents, available)
           VALUES (md5($1::text || ':menu:' || $3)::uuid, $1::uuid, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE
             SET category = EXCLUDED.category, description = EXCLUDED.description,
                 price_cents = EXCLUDED.price_cents, available = EXCLUDED.available`,
          [tenantId, m.category, m.name, m.description, m.price * 100, m.available ?? true],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const pool = createPool(config.DATABASE_URL);
  seed(pool)
    .then(() => console.log(`Seed aplicado: ${SEED_TENANTS.map((t) => t.slug).join(', ')}`))
    .finally(() => pool.end());
}
