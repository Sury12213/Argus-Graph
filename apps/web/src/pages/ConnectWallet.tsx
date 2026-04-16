import { useCallback, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { motion } from 'framer-motion';
import { useAuthStore } from '../stores';
import { authApi } from '../services/api';
import bs58 from 'bs58';

const ConnectWallet = () => {
  const { publicKey, signMessage, connected } = useWallet();
  const { setAuth } = useAuthStore();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState('');

  const handleAuthenticate = useCallback(async () => {
    if (!publicKey || !signMessage) return;

    setIsAuthenticating(true);
    setError('');

    try {
      // Step 1: Request nonce
      const { data: nonceRes } = await authApi.requestNonce(publicKey.toBase58());
      const { nonce, message } = nonceRes.data;

      // Step 2: Sign message with wallet
      const encodedMessage = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(encodedMessage);
      const signature = bs58.encode(signatureBytes);

      // Step 3: Verify signature and get JWT
      const { data: authRes } = await authApi.verifySignature(
        publicKey.toBase58(),
        signature,
        nonce,
      );

      const { accessToken, refreshToken } = authRes.data;
      localStorage.setItem('argus_refresh_token', refreshToken);
      setAuth(accessToken, { walletAddress: publicKey.toBase58() });
    } catch (err: any) {
      console.error('Auth error:', err);
      setError(err.response?.data?.error || 'Authentication failed. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  }, [publicKey, signMessage, setAuth]);

  return (
    <div className="connect-page">
      <motion.div
        className="connect-card"
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <motion.div
          className="connect-logo"
          initial={{ rotate: -10 }}
          animate={{ rotate: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          🛡️
        </motion.div>

        <motion.h1
          className="connect-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          Argus-Graph
        </motion.h1>

        <motion.p
          className="connect-subtitle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          High-Frequency Risk Engine for Solana
          <br />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            Protect your investments with AI-powered threat detection
          </span>
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          {!connected ? (
            <WalletMultiButton />
          ) : (
            <>
              <div style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--color-safe-bg)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(0, 233, 158, 0.2)',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-safe)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <span style={{ fontSize: '12px' }}>●</span>
                Wallet connected: {publicKey?.toBase58().slice(0, 4)}...{publicKey?.toBase58().slice(-4)}
              </div>

              <button
                className="btn btn-primary btn-lg"
                onClick={handleAuthenticate}
                disabled={isAuthenticating}
                style={{ width: '100%' }}
              >
                {isAuthenticating ? (
                  <>
                    <span className="spinner" />
                    Signing message...
                  </>
                ) : (
                  '🔐 Sign Message to Enter'
                )}
              </button>
            </>
          )}

          {error && (
            <div style={{
              padding: 'var(--space-3)',
              background: 'var(--color-danger-bg)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(255, 71, 87, 0.2)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-danger)',
            }}>
              {error}
            </div>
          )}

          {/* Separator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-2)',
          }}>
            <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
          </div>

          {/* Demo Mode */}
          <button
            className="btn btn-secondary btn-lg"
            onClick={() => {
              setAuth('demo-token-for-preview', { walletAddress: 'DemoWallet...ARGUS' });
            }}
            style={{ width: '100%' }}
          >
            🚀 Enter Demo Mode
          </button>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
            Preview the dashboard with mock data — no wallet needed
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          style={{
            marginTop: 'var(--space-8)',
            display: 'flex',
            gap: 'var(--space-6)',
            justifyContent: 'center',
          }}
        >
          {['Cluster Detection', 'Velocity Analysis', 'Smart Money'].map((feature) => (
            <div key={feature} style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}>
              <span style={{ color: 'var(--color-primary-light)' }}>✦</span>
              {feature}
            </div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
};

export default ConnectWallet;
