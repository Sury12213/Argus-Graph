import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Bell } from 'lucide-react';
import { useAuthStore } from '../../stores';

const Header = () => {
  const { publicKey } = useWallet();
  const { logout } = useAuthStore();

  const shortAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : '';

  return (
    <header className="header">
      <div className="header-title">
        {/* Dynamic title based on route — can enhance later */}
      </div>

      <div className="header-actions">
        <button className="btn btn-ghost btn-icon" title="Notifications">
          <Bell size={18} />
        </button>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--color-bg-tertiary)',
          borderRadius: 'var(--radius-full)',
          border: '1px solid var(--color-border)',
        }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--color-safe)',
            boxShadow: 'var(--shadow-glow-safe)',
          }} />
          <span style={{
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-secondary)',
          }}>
            {shortAddress}
          </span>
        </div>

        <button
          className="btn btn-ghost"
          onClick={logout}
          style={{ fontSize: 'var(--text-xs)' }}
        >
          Disconnect
        </button>
      </div>
    </header>
  );
};

export default Header;
