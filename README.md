# Pedido Grupal en Tiempo Real

Varias personas entran a un pedido compartido de una hamburguesería por link, cada una agrega sus
ítems y todos ven los cambios en vivo. Es un sistema **multi-tenant**: el mismo software sirve a
varias cadenas, cada una con su marca, sucursales y menú.

La demo muestra una sola cadena, **Hamburguesería Test**. El seed carga una segunda (Smashlab) que
no aparece en la UI: existe para los tests de aislamiento entre cadenas.

> Proyecto de portfolio. Las cadenas, sucursales y menús son inventados. Las fotos de productos son
> de Pexels (ver [CREDITS.md](CREDITS.md)).

_README en construcción: se completa en la fase 7 con demo, diagrama y guía completa._

## Correrlo local

```bash
npm install
docker compose up -d --build   # Postgres, Redis, migraciones + seed, 2 servers detrás de nginx
curl localhost:8080/health
npm test                       # tests de integración contra el Postgres/Redis de docker
```

Postgres queda expuesto en el puerto **5433** del host (para no chocar con un Postgres local).
Los tests de integración usan su propia base (`pedido_test`), así no ensucian la de la demo.

```bash
npm run dev:web        # front en http://localhost:5173 (habla con nginx → las 2 instancias)
npm run simulate       # N bots operando a la vez; al final verifica que todos quedaron iguales
npm run e2e            # Playwright: 3 navegadores, desconexión + resync, cierre y envío
npm run screenshots    # capturas de las pantallas principales en demo/screenshots (con dev:web corriendo)
```

### Video de la demo

`demo/demo.mp4` (4:5, 1080×1350) y `demo/demo.gif` se generan en dos pasos:

```bash
npm run record-demo              # Playwright graba 3 celulares usando la app en vivo (con dev:web corriendo)
npm run render -w apps/video     # Remotion arma el MP4: gancho, toques, sincronización, zoom, subtítulos
npm run render:gif -w apps/video # GIF liviano
```

La grabación exporta un timeline con cada toque y el momento en que cada cambio quedó **pintado**
en las otras pantallas. La etiqueta "sincronizado en N ms" del video usa esa latencia medida, no un
número inventado. Remotion es gratis para uso individual; revisá su licencia si lo usa una empresa.

El e2e levanta siempre su propio servidor de Vite (no reutiliza uno que ya esté corriendo).

`npm run simulate -- --code ABC234` suma los bots a un pedido que tengas abierto en el navegador,
para verlos operar en vivo. Con `--urls http://localhost:3001,http://localhost:3002` cada bot se
conecta directo a una instancia distinta.

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

### Salas por cadena y pedido

Cada pedido tiene su sala `tenant:{tenantId}:order:{orderId}`. El cliente **no elige** a qué sala
entra: la sala se deriva del token, verificado en el handshake contra la cadena de la URL. Un token
de otra cadena se rechaza antes de conectar.

### Emitir solo después del COMMIT, sin reintentos

El evento se emite a la sala recién después de que la transacción hizo `COMMIT`, así nadie ve un
cambio que después se deshace. Si el emit falla, **no se reintenta**. Cada evento lleva su
`version` y el cliente los aplica estrictamente en orden. Si recibe la versión 7 estando en la 5,
sabe que se perdió algo y pide un resync en lugar de aplicarlo a ciegas. Lo mismo al reconectar:
pide los eventos desde la última versión vista, o recibe un snapshot completo si el hueco es grande.
El log `order_events` es la fuente para resincronizar, no la entrega de Socket.IO.

Las respuestas de error (`ORDER_LOCKED`, `NOT_OWNER`, …) incluyen la versión actual del pedido: si
es mayor que la local, el cliente sabe que le falta algo y resincroniza.

### Presencia efímera

"Conectado" y "está eligiendo…" viven solo en los sockets y se comparten entre instancias por el
adapter de Redis. **Nunca** se escriben en Postgres ni suben la `version` del pedido: son datos
que pierden sentido a los segundos y no deben ensuciar el log de eventos.

### Rate limit por conexión

Cada conexión tiene un token bucket en memoria. Como una conexión WebSocket está fija en una
instancia, no hace falta compartir ese contador. Los eventos que exceden el límite se descartan y
se responden con `RATE_LIMITED`. Esa respuesta no consulta la versión, para no cargar la base
justo cuando alguien está inundando. Los endpoints HTTP públicos (preview y unirse) sí tienen un
rate limit por IP compartido en Redis, porque cada request puede caer en otra instancia.

## Interfaz

- **React + Vite + Tailwind v4**, con [shadcn/ui](https://ui.shadcn.com) como base de componentes y un
  **tema propio** (`apps/web/src/index.css`): un solo color de acento (el de la cadena), el resto
  blanco, negro y grises; radios de 6 a 12 px; sin degradés ni sombras de color; una sola familia
  tipográfica (Archivo, variable en peso y ancho: la versión condensada arma el logo de texto).
- **[Vaul](https://vaul.emilkowal.ski)** para los bottom sheets (detalle de producto y resumen final).
  ⚠️ Vaul está **sin mantenimiento** ("This repo is unmaintained", según su README). Funciona con
  React 19 y alcanza para la demo; la alternativa sería el `Drawer` actual de shadcn/ui, que ya no
  usa Vaul sino Base UI.
- **[Sonner](https://sonner.emilkowal.ski)** para avisos discretos: qué agregó otra persona, cierre
  del pedido y rechazos del server.
- **[Motion](https://motion.dev)** para el resaltado de cambios remotos (fondo suave que se desvanece
  en ~1 s, con el avatar de quien hizo el cambio) y la entrada y salida de ítems.

### Modo debug

La UI pública no muestra herramientas de desarrollo. Con `?debug=1` (queda recordado en la
pestaña; `?debug=0` lo apaga) aparecen:

- la pestaña **Actividad**, con cada evento y su número de versión, desconexiones y resyncs;
- el botón **Simular desconexión**, que corta el socket unos segundos para ver el resync;
- la vista de **cocina** de cada sucursal: `/t/hamburgueseria-test/branch/<id>/kitchen?debug=1`.

El e2e usa este modo; las capturas, no.
