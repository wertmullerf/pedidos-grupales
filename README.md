# Pedido Grupal en Tiempo Real

Varias personas entran a un pedido compartido de una hamburguesería por link, cada una agrega sus
ítems y todos ven los cambios en vivo. Es un sistema **multi-tenant**: el mismo software sirve a
varias cadenas, cada una con su marca, sucursales y menú.

> Proyecto de portfolio. Las cadenas, sucursales y menús son inventados.

_README en construcción: se completa en la fase 7 con demo, diagrama y guía completa._

## Correrlo local

```bash
npm install
docker compose up -d --build   # Postgres, Redis, migraciones + seed, 2 servers detrás de nginx
curl localhost:8080/health
npm test                       # tests de integración contra el Postgres/Redis de docker
```

Postgres queda expuesto en el puerto **5433** del host (para no chocar con un Postgres local).

## Decisiones de concurrencia

### Cada participante solo edita sus propios ítems

Todas las mutaciones sobre `order_items` filtran por `participant_id`. Dos personas nunca compiten
por la misma fila, lo que elimina la mayoría de los conflictos por diseño en lugar de resolverlos
después.

### Una transacción corta de 3 statements por operación

1. `UPDATE group_orders SET version = version + 1 WHERE id = … AND tenant_id = … AND status = 'open' RETURNING version`
   — toma el lock de la fila del pedido, verifica que esté abierto y asigna la versión del evento.
2. `INSERT INTO order_events … ON CONFLICT (client_op_id) DO NOTHING` — registra el evento y
   resuelve la idempotencia: si el `clientOpId` ya existe, se hace `ROLLBACK` y se responde como
   operación ya aplicada.
3. La mutación sobre `order_items`, con deltas (`quantity = quantity + $delta`), nunca valores absolutos.

### Orden fijo de locks: por qué no hay deadlocks

Un deadlock necesita dos transacciones que tomen locks en orden inverso. Acá eso no puede pasar:

- **Toda transacción que modifica un pedido bloquea primero su fila de `group_orders`**, en el primer
  statement. Recién después toca `order_events`, `order_items` o `participants` de ese mismo pedido.
- Dos operaciones sobre el mismo pedido se encuentran en ese primer statement: la segunda espera
  **sin tener ningún otro lock tomado**, así que no puede formar un ciclo.
- Cada transacción toca **un solo pedido**, así que no existe un orden entre pedidos que respetar.
  Operaciones de pedidos distintos no se esperan entre sí.
- Las filas compartidas (`menu_items`, `branches`) solo se leen. Los chequeos de claves foráneas
  toman sobre ellas `FOR KEY SHARE`, un lock compatible consigo mismo.
- Crear un pedido inserta una fila nueva, que ninguna otra transacción puede estar bloqueando.

El mismo lock hace que **cerrar el pedido no tenga carreras**: el cierre también es un
`UPDATE … WHERE status = 'open'`, así que cualquier operación que se serialice después ve
`status = 'locked'` y es rechazada con `ORDER_LOCKED`, aunque haya salido del cliente antes.

## Tiempo real

### Socket.IO solo con WebSocket

Cliente y servidor usan `transports: ['websocket']`. Con el transporte por defecto, Socket.IO
empieza con long-polling HTTP: varias requests que **tienen que llegar a la misma instancia**.
Detrás de nginx en round-robin, sin sticky sessions, esas requests caerían en servers distintos y
el handshake fallaría. Una conexión WebSocket es una única conexión TCP que queda fija en una
instancia, así que no hace falta afinidad. Los mensajes entre instancias los reparte el adapter de
Redis.
