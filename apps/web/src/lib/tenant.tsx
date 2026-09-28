import type { TenantInfo } from '@pedido/shared';
import { createContext, useContext, useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api, ApiError } from './api';

/** La cadena que abre la app: no hay selector de comercio. */
export const DEFAULT_TENANT = 'hamburgueseria-test';

const TenantContext = createContext<TenantInfo | null>(null);

export function useTenant(): TenantInfo {
  const tenant = useContext(TenantContext);
  if (!tenant) throw new Error('useTenant fuera de TenantLayout');
  return tenant;
}

/** Rutas /t/:tenantSlug/*: carga la cadena y usa su color como único acento de la app. */
export function TenantLayout() {
  const { tenantSlug = '' } = useParams();
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.tenant(tenantSlug).then(
      (t) => alive && setTenant(t),
      (e: ApiError) =>
        alive && setError(e.code === 'TENANT_NOT_FOUND' ? 'No encontramos este local' : e.message),
    );
    return () => {
      alive = false;
    };
  }, [tenantSlug]);

  useEffect(() => {
    if (!tenant) return;
    const root = document.documentElement;
    root.style.setProperty('--brand', tenant.primaryColor);
    document.title = `${tenant.name} · Pedido grupal`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#ffffff');
    return () => {
      root.style.removeProperty('--brand');
    };
  }, [tenant]);

  if (error) {
    return (
      <div className="grid min-h-dvh place-content-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold">{error}</p>
        <Button variant="outline" asChild>
          <a href={`/t/${DEFAULT_TENANT}`}>Volver al inicio</a>
        </Button>
      </div>
    );
  }
  if (!tenant) return <div className="min-h-dvh" aria-busy="true" />;

  return (
    <TenantContext.Provider value={tenant}>
      <Outlet />
    </TenantContext.Provider>
  );
}
