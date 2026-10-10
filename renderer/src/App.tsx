import { useEffect, useState } from 'react';
import { Layout, type PageKey } from './components/Layout';
import { ToastHost } from './components/Toast';
import { DashboardPage } from './pages/DashboardPage';
import { ProfilePage } from './pages/ProfilePage';
import { DiscoverPage } from './pages/DiscoverPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { SettingsPage } from './pages/SettingsPage';
import { api } from './lib/api';

export default function App() {
  const [page, setPage] = useState<PageKey>('dashboard');

  useEffect(() => {
    void api.ensureProfile().catch(() => undefined);
  }, []);

  return (
    <Layout page={page} onNavigate={setPage}>
      <div className="h-full overflow-y-auto p-6">
        {page === 'dashboard' ? <DashboardPage onNavigate={setPage} /> : null}
        {page === 'profile' ? <ProfilePage /> : null}
        {page === 'discover' ? <DiscoverPage /> : null}
        {page === 'applications' ? <ApplicationsPage /> : null}
        {page === 'settings' ? <SettingsPage /> : null}
      </div>
      <ToastHost />
    </Layout>
  );
}
