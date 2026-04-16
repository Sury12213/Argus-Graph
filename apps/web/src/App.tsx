import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores';
import Layout from './components/layout/Layout';
import ConnectWallet from './pages/ConnectWallet';
import Dashboard from './pages/Dashboard';
import ScanPage from './pages/ScanPage';
import ScanResult from './pages/ScanResult';
import Settings from './pages/Settings';

function App() {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <ConnectWallet />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/scan" element={<ScanPage />} />
        <Route path="/scan/:id" element={<ScanResult />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
