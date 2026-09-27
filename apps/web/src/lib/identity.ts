// Identidad del participante en un pedido: el token firmado que devuelve el server.
// Se guarda por pestaña (sessionStorage): cada pestaña puede ser una persona distinta,
// que es justo lo que se quiere para probar el pedido grupal abriendo varias pestañas.

export interface Identity {
  token: string;
  participantId: string;
  name: string;
}

const key = (slug: string, code: string) => `pedido:${slug}:${code.toUpperCase()}`;

export function loadIdentity(slug: string, code: string): Identity | null {
  try {
    const raw = sessionStorage.getItem(key(slug, code));
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export function saveIdentity(slug: string, code: string, identity: Identity) {
  try {
    sessionStorage.setItem(key(slug, code), JSON.stringify(identity));
  } catch {
    // Sin storage (modo privado estricto): la sesión dura lo que la pestaña.
  }
}

export function clearIdentity(slug: string, code: string) {
  try {
    sessionStorage.removeItem(key(slug, code));
  } catch {
    /* nada */
  }
}
