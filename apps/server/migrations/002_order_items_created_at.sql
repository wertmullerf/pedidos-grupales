-- Orden estable de las líneas en el snapshot (el id es un UUID aleatorio).
ALTER TABLE order_items ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
