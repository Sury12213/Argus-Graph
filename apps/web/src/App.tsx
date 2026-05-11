import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores';
import { authApi, userApi } from './services/api';
import Layout from './components/layout/Layout';
import LandingPage from './pages/LandingPage';
import ConnectWallet from './pages/ConnectWallet';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const ScanPage = lazy(() => import('./pages/ScanPage'));
const ScanResult = lazy(() => import('./pages/ScanResult'));
const ScanHistory = lazy(() => import('./pages/ScanHistory'));
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Settings = lazy(() => import('./pages/Settings'));

function App() {
  const { isAuthenticated, isBootstrapping, setAuth, setBootstrapping, logout } = useAuthStore();
  const [showConnect, setShowConnect] = useState(false);

  useEffect(() => {
    const restoreAuth = async () => {
      const token = localStorage.getItem('argus_token');
      if (!token) {
        setBootstrapping(false);
        return;
      }

      try {
        const profile = await userApi.getProfile();
        setAuth(token, profile.data);
        return;
      } catch {
        const refreshToken = localStorage.getItem('argus_refresh_token');
        if (!refreshToken) {
          logout();
          return;
        }

        try {
          const refreshed = await authApi.refresh(refreshToken);
          const accessToken = refreshed.data.accessToken ?? refreshed.data.token;
          const nextRefreshToken = refreshed.data.refreshToken;
          localStorage.setItem('argus_token', accessToken);
          if (nextRefreshToken) localStorage.setItem('argus_refresh_token', nextRefreshToken);
          const profile = await userApi.getProfile();
          setAuth(accessToken, profile.data);
        } catch {
          logout();
        }
      }
    };

    void restoreAuth();
  }, [logout, setAuth, setBootstrapping]);

  if (isBootstrapping) {
    return <div className="loading-screen">Restoring session...</div>;
  }

  if (!isAuthenticated) {
    if (showConnect) {
      return <ConnectWallet />;
    }
    return <LandingPage onConnect={() => setShowConnect(true)} />;
  }

  return (
    <Layout>
      <Suspense fallback={<div className="loading-screen">Loading page...</div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/scan/:id" element={<ScanResult />} />
          <Route path="/history" element={<ScanHistory />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

export default App;

