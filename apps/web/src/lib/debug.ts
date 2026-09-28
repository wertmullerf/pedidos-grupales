// Modo debug: vistas de desarrollo (cocina, actividad, versiones, simular desconexión) que NO son
// parte de la app pública. Se activa con ?debug=1 (queda recordado en la pestaña) y se apaga con ?debug=0.

const KEY = 'pedido:debug';

function readDebugFlag(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get('debug');
    if (param === '1') sessionStorage.setItem(KEY, '1');
    if (param === '0') sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const DEBUG = readDebugFlag();
