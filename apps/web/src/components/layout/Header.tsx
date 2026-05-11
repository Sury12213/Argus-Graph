import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { Bell, LogOut, Menu, ScanSearch, Wallet } from 'lucide-react';
import { useAuthStore } from '../../stores';

type HeaderProps = {
  currentPath: string;
  onOpenSidebar: () => void;
};

const routeTitles = [
  { test: (path: string) => path === '/', title: 'Intelligence overview', subtitle: 'Risk exposure, scan activity, and watchlist signals.' },
  { test: (path: string) => path.startsWith('/scan/'), title: 'Scan report', subtitle: 'Cluster, social, velocity, and execution intelligence.' },
  { test: (path: string) => path === '/scan', title: 'Run wallet scan', subtitle: 'Analyze wallet risk and connected on-chain signals.' },
  { test: (path: string) => path === '/watchlist', title: 'Watchlist', subtitle: 'Monitored wallets and alert conditions.' },
  { test: (path: string) => path === '/history', title: 'Scan history', subtitle: 'Past intelligence reports and decisions.' },
  { test: (path: string) => path === '/settings', title: 'Settings', subtitle: 'Risk thresholds, notifications, and account preferences.' },
];

const Header = ({ currentPath, onOpenSidebar }: HeaderProps) => {
  const { publicKey, disconnect } = useWallet();
  const { logout } = useAuthStore();

  const handleDisconnect = async () => {
    logout();
    await disconnect().catch(() => undefined);
  };

  const shortAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : 'No wallet';

  const route = useMemo(
    () => routeTitles.find((item) => item.test(currentPath)) ?? routeTitles[0],
    [currentPath]
  );

  return (
    <header className="header">
      <div className="header-left">
        <button className="btn btn-ghost btn-icon mobile-menu-button" onClick={onOpenSidebar} aria-label="Open navigation">
          <Menu size={18} />
        </button>
        <div>
          <div className="header-title">{route.title}</div>
          <div className="header-subtitle">{route.subtitle}</div>
        </div>
      </div>

      <div className="header-actions">
        <Link className="btn btn-primary hide-mobile" to="/scan">
          <ScanSearch size={16} />
          New scan
        </Link>

        <button className="btn btn-ghost btn-icon" title="Notifications" aria-label="Notifications">
          <Bell size={18} />
        </button>

        <div className="wallet-pill">
          <Wallet size={16} />
          <span>{shortAddress}</span>
        </div>

        <button className="btn btn-ghost" onClick={handleDisconnect} aria-label="Disconnect wallet">
          <LogOut size={16} />
          <span className="hide-mobile">Disconnect</span>
        </button>
      </div>
    </header>
  );
};

export default Header;

