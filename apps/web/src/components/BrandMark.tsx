import type { TenantInfo } from '@pedido/shared';

/** Logo de la cadena; si no tiene, la inicial sobre su color. */
export function BrandMark({ tenant, size = 40 }: { tenant: TenantInfo; size?: number }) {
  if (tenant.logoUrl) {
    return (
      <img
        src={tenant.logoUrl}
        alt={`Logo de ${tenant.name}`}
        width={size}
        height={size}
        style={{ borderRadius: size * 0.25, display: 'block', flexShrink: 0 }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        background: tenant.primaryColor,
        color: '#fff',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
        fontSize: size * 0.45,
        flexShrink: 0,
      }}
    >
      {tenant.name.charAt(0)}
    </span>
  );
}
