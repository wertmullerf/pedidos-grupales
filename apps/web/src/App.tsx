import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { TenantLayout } from './lib/tenant';
import { KitchenPage } from './pages/KitchenPage';
import { LandingPage } from './pages/LandingPage';
import { OrderRoute } from './pages/OrderRoute';
import { TenantHome } from './pages/TenantHome';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/t/:tenantSlug" element={<TenantLayout />}>
          <Route index element={<TenantHome />} />
          <Route path="o/:code" element={<OrderRoute />} />
          <Route path="branch/:branchId/kitchen" element={<KitchenPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
