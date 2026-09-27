CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  primary_color text NOT NULL,
  logo_url      text
);

CREATE TABLE branches (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name      text NOT NULL,
  address   text NOT NULL,
  is_open   boolean NOT NULL DEFAULT true
);
CREATE INDEX branches_tenant_idx ON branches (tenant_id);

-- Precios en centavos (enteros) para no arrastrar errores de punto flotante.
CREATE TABLE menu_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  category    text NOT NULL,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  available   boolean NOT NULL DEFAULT true
);
CREATE INDEX menu_items_tenant_idx ON menu_items (tenant_id);

CREATE TABLE group_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  branch_id           uuid NOT NULL REFERENCES branches(id),
  code                char(6) NOT NULL,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'submitted')),
  host_participant_id uuid,
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE participants (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id  uuid NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
  name      text NOT NULL,
  color     text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX participants_order_idx ON participants (order_id);

-- Referencia circular pedido <-> host: diferida para poder crear ambos en la misma transacción.
ALTER TABLE group_orders
  ADD CONSTRAINT group_orders_host_fk FOREIGN KEY (host_participant_id)
  REFERENCES participants(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE order_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  menu_item_id   uuid NOT NULL REFERENCES menu_items(id),
  quantity       integer NOT NULL CHECK (quantity > 0),
  notes          text NOT NULL DEFAULT ''
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

-- Log append-only. client_op_id UNIQUE resuelve la idempotencia sin tabla aparte.
CREATE TABLE order_events (
  id           bigserial PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  client_op_id uuid NOT NULL UNIQUE,
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, version)
);
