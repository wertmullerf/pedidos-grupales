import type { CommandName, ErrorCode } from '@pedido/shared';

/** Texto para el usuario cuando el server rechaza una operación. Nunca un error genérico si hay uno claro. */
export function rejectionMessage(code: ErrorCode | 'NETWORK', command?: CommandName): string {
  switch (code) {
    case 'ORDER_LOCKED':
      return 'El pedido se cerró, tu último cambio no se aplicó';
    case 'INVALID_STATUS':
      return 'El pedido cambió de estado, actualizamos la pantalla';
    case 'NOT_OWNER':
      return 'Solo podés cambiar lo que agregaste vos';
    case 'NOT_HOST':
      return 'Solo quien armó el pedido puede hacer eso';
    case 'MENU_ITEM_UNAVAILABLE':
      return 'Ese producto se quedó sin stock';
    case 'MENU_ITEM_NOT_FOUND':
      return 'Ese producto ya no está en el menú';
    case 'ITEM_NOT_FOUND':
      return 'Esa línea ya no existe';
    case 'EMPTY_ORDER':
      return 'El pedido está vacío: agreguen algo antes de enviarlo';
    case 'BRANCH_CLOSED':
      return 'La sucursal está cerrada en este momento';
    case 'RATE_LIMITED':
      return 'Vas muy rápido, esperá un segundo';
    case 'NETWORK':
      return 'Sin conexión: tu cambio se va a enviar cuando vuelva';
    default:
      return command === 'order:submit'
        ? 'No pudimos enviar el pedido, probá de nuevo'
        : 'No pudimos aplicar tu cambio';
  }
}
