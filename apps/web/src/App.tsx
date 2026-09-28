import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { DEBUG } from '@/lib/debug';
import { DEFAULT_TENANT, TenantLayout } from '@/lib/tenant';
import { KitchenPage } from '@/pages/KitchenPage';
import { OrderRoute } from '@/pages/OrderRoute';
import { TenantHome } from '@/pages/TenantHome';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to={`/t/${DEFAULT_TENANT}`} replace />} />
        <Route path="/t/:tenantSlug" element={<TenantLayout />}>
          <Route index element={<TenantHome />} />
          <Route path="o/:code" element={<OrderRoute />} />
          {/* Vista de la sucursal: herramienta de desarrollo, solo con ?debug=1. */}
          {DEBUG && <Route path="branch/:branchId/kitchen" element={<KitchenPage />} />}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
