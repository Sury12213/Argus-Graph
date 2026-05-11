import { NavLink } from 'react-router-dom';
import {
  Clock3,
  LayoutDashboard,
  Radar,
  ScanSearch,
  Settings,
  WalletCards,
} from 'lucide-react';
import argusLogo from '../../assets/argus-logo.svg';

type SidebarProps = {
  isOpen?: boolean;
  onNavigate?: () => void;
};

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/scan', label: 'Scan Wallet', icon: ScanSearch },
  { to: '/watchlist', label: 'Watchlist', icon: Radar },
  { to: '/history', label: 'Scan History', icon: Clock3 },
];

const Sidebar = ({ isOpen = false, onNavigate }: SidebarProps) => {
  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`} aria-label="Primary navigation">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon" aria-hidden="true">
          <img src={argusLogo} alt="" />
        </div>
        <div>
          <div className="sidebar-logo-text">Argus-Graph</div>
          <div className="sidebar-logo-version">Wallet intelligence</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section-title">Intelligence</div>
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Icon className="nav-link-icon" />
            {label}
          </NavLink>
        ))}

        <div className="sidebar-section-title">Account</div>
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <Settings className="nav-link-icon" />
          Settings
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-network">
          <WalletCards size={16} />
          <div>
            <div className="sidebar-network__label">Solana Mainnet</div>
            <div className="sidebar-network__status">Live data channel</div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;


