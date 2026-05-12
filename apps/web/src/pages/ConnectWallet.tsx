import { useCallback, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { motion } from 'framer-motion';
import { CheckCircle2, LockKeyhole, Radio, Signature, Wallet } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuthStore } from '../stores';
import bs58 from 'bs58';
import argusLogo from '../assets/argus-logo.svg';

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
      const { data: nonceRes } = await authApi.requestNonce(publicKey.toBase58());
      const { nonce, message } = nonceRes.data;
      const encodedMessage = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(encodedMessage);
      const signature = bs58.encode(signatureBytes);
      const { data: authRes } = await authApi.verifySignature(publicKey.toBase58(), signature, nonce);
      const { accessToken, refreshToken } = authRes.data;
      localStorage.setItem('argus_refresh_token', refreshToken);
      setAuth(accessToken, { walletAddress: publicKey.toBase58() });
    } catch (err: unknown) {
      console.error('Auth error:', err);
      const response = (err as { response?: { data?: { error?: string } } }).response;
      setError(response?.data?.error || 'Authentication failed. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  }, [publicKey, signMessage, setAuth]);

  return (
    <div className="connect-page">
      <motion.div className="connect-card" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.45 }}>
        <div className="connect-logo"><img src={argusLogo} alt="" /></div>
        <h1 className="connect-title">Argus-Graph</h1>
        <p className="connect-subtitle">Connect a Solana wallet to access scan history, watchlists, and execution safety workflows.</p>

        <div className="connect-security-grid">
          <div><LockKeyhole size={16} /> No seed phrase requests</div>
          <div><Signature size={16} /> Signature-based login</div>
          <div><Radio size={16} /> Live intelligence channel</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
          {!connected ? (
            <WalletMultiButton />
          ) : (
            <>
              <div className="auth-status auth-status--success">
                <CheckCircle2 size={16} />
                Wallet connected: {publicKey?.toBase58().slice(0, 4)}...{publicKey?.toBase58().slice(-4)}
              </div>
              <button className="btn btn-primary btn-lg" onClick={handleAuthenticate} disabled={isAuthenticating} style={{ width: '100%' }}>
                {isAuthenticating ? 'Signing message...' : <><Wallet size={18} /> Sign message to enter</>}
              </button>
            </>
          )}

          {error && <div className="auth-status auth-status--danger">{error}</div>}
        </div>
      </motion.div>
    </div>
  );
};

export default ConnectWallet;


