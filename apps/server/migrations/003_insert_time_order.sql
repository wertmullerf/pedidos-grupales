-- joined_at y created_at definen el orden de participantes y líneas en el snapshot. Con now() valían
-- la hora de INICIO de la transacción: dos joins concurrentes podían quedar en orden distinto al de
-- sus versiones (el que empezó primero no siempre toma primero el lock del pedido), y un cliente
-- cargado por snapshot veía otro orden que uno armado con eventos.
-- clock_timestamp() es la hora real del INSERT, que ocurre con el lock del pedido ya tomado: sigue
-- el mismo orden de serialización que las versiones.
ALTER TABLE participants ALTER COLUMN joined_at SET DEFAULT clock_timestamp();
ALTER TABLE order_items ALTER COLUMN created_at SET DEFAULT clock_timestamp();
