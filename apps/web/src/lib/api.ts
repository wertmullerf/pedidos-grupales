import type {
  ApiErrorBody,
  Branch,
  ErrorCode,
  JoinResponse,
  KitchenOrder,
  MenuItem,
  OrderPreview,
  TenantInfo,
} from '@pedido/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No pudimos conectarnos. Revisá tu conexión.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error.code ?? 'INTERNAL', body?.error.message ?? 'Error');
  }
  return (await res.json()) as T;
}

const t = (slug: string) => `/t/${encodeURIComponent(slug)}`;

export const api = {
  tenant: (slug: string) => request<TenantInfo>(t(slug)),
  branches: (slug: string) => request<Branch[]>(`${t(slug)}/branches`),
  menu: (slug: string) => request<MenuItem[]>(`${t(slug)}/menu`),
  preview: (slug: string, code: string) => request<OrderPreview>(`${t(slug)}/orders/${code}`),
  createOrder: (slug: string, branchId: string, name: string) =>
    request<JoinResponse>(`${t(slug)}/orders`, {
      method: 'POST',
      body: JSON.stringify({ branchId, name }),
    }),
  joinOrder: (slug: string, code: string, name: string) =>
    request<JoinResponse>(`${t(slug)}/orders/${code}/join`, {
      method: 'POST',
      body: JSON.stringify({ name, clientOpId: crypto.randomUUID() }),
    }),
  kitchenOrders: (slug: string, branchId: string) =>
    request<KitchenOrder[]>(`${t(slug)}/branches/${branchId}/kitchen/orders`),
};
