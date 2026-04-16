import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Search,
  Settings,
  Shield,
  Activity,
  Wallet,
} from 'lucide-react';

const Sidebar = () => {
  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">🛡️</div>
        <div>
          <div className="sidebar-logo-text">Argus-Graph</div>
          <div className="sidebar-logo-version">v3.0 — Risk Engine</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="sidebar-section-title">Main</div>

        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `nav-link ${isActive ? 'active' : ''}`
          }
        >
          <LayoutDashboard className="nav-link-icon" />
          Dashboard
        </NavLink>

        <NavLink
          to="/scan"
          className={({ isActive }) =>
            `nav-link ${isActive ? 'active' : ''}`
          }
        >
          <Search className="nav-link-icon" />
          Scan Token
        </NavLink>

        <div className="sidebar-section-title">Analytics</div>

        <NavLink
          to="/clusters"
          className={({ isActive }) =>
            `nav-link ${isActive ? 'active' : ''}`
          }
        >
          <Shield className="nav-link-icon" />
          Cluster Map
        </NavLink>

        <NavLink
          to="/velocity"
          className={({ isActive }) =>
            `nav-link ${isActive ? 'active' : ''}`
          }
        >
          <Activity className="nav-link-icon" />
          Velocity
        </NavLink>

        <NavLink
          to="/smart-money"
          className={({ isActive }) =>
            `nav-link ${isActive ? 'active' : ''}`
          }
        >
          <Wallet className="nav-link-icon" />
          Smart Money
        </NavLink>

        <div className="sidebar-section-title">Account</div>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `nav-link ${isActive ? 'active' : ''}`
          }
        >
          <Settings className="nav-link-icon" />
          Settings
        </NavLink>
      </nav>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid var(--color-border)',
        paddingTop: 'var(--space-4)',
        marginTop: 'var(--space-4)',
      }}>
        <div style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          textAlign: 'center',
        }}>
          Powered by Solana
          <br />
          <span style={{ color: 'var(--color-safe)' }}>●</span> Mainnet Beta
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
