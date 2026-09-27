import type { TenantInfo } from '@pedido/shared';
import { createContext, useContext, useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { api, ApiError } from './api';
import styles from './tenant.module.css';

const TenantContext = createContext<TenantInfo | null>(null);

export function useTenant(): TenantInfo {
  const tenant = useContext(TenantContext);
  if (!tenant) throw new Error('useTenant fuera de TenantLayout');
  return tenant;
}

/** Aplica el color de la cadena a toda la app vía CSS variables. */
export function useBrandColor(color: string | undefined) {
  useEffect(() => {
    if (!color) return;
    const root = document.documentElement;
    root.style.setProperty('--brand', color);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    return () => {
      root.style.removeProperty('--brand');
    };
  }, [color]);
}

/** Rutas /t/:tenantSlug/*: carga la cadena y tiñe la app con su marca. */
export function TenantLayout() {
  const { tenantSlug = '' } = useParams();
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.tenant(tenantSlug).then(
      (t) => alive && setTenant(t),
      (e: ApiError) =>
        alive && setError(e.code === 'TENANT_NOT_FOUND' ? 'Esta cadena no existe' : e.message),
    );
    return () => {
      alive = false;
    };
  }, [tenantSlug]);

  useBrandColor(tenant?.primaryColor);

  useEffect(() => {
    if (tenant) document.title = `${tenant.name} · Pedido grupal`;
  }, [tenant]);

  if (error) {
    return (
      <div className={styles.center}>
        <p className={styles.errorTitle}>{error}</p>
        <a className="btn btn-secondary" href="/">
          Volver al inicio
        </a>
      </div>
    );
  }
  if (!tenant) return <div className={styles.center} aria-busy="true" />;

  return (
    <TenantContext.Provider value={tenant}>
      <Outlet />
    </TenantContext.Provider>
  );
}
