import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Trash2, Plus, Bell, BellOff, RefreshCw } from 'lucide-react';
import { watchlistApi, scanApi } from '../services/api';

interface WatchlistItem {
  id: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  alertEnabled: boolean;
  createdAt: string;
  lastScan: {
    finalScore: number;
    decision: string;
    createdAt: string;
  } | null;
}

interface TokenCandidate {
  address: string;
  symbol?: string;
  name?: string;
  liquidityUsd?: number;
  volume24h?: number;
  url?: string;
}

const Watchlist = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addInput, setAddInput] = useState('');
  const [scanning, setScanning] = useState<string | null>(null);
  const [tokenCandidates, setTokenCandidates] = useState<TokenCandidate[]>([]);
  const [addError, setAddError] = useState('');

  const loadWatchlist = useCallback(async () => {
    try {
      const { data } = await watchlistApi.list();
      setItems(data.data ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWatchlist();
  }, [loadWatchlist]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addInput.trim()) return;

    try {
      setAddError('');
      setTokenCandidates([]);
      const symbolMatch = addInput.match(/\$([A-Za-z]+)/);
      const { data } = await watchlistApi.add(addInput.trim(), symbolMatch ? `$${symbolMatch[1]}` : undefined);
      if (data.data?.status === 'AMBIGUOUS') {
        setTokenCandidates(data.data.candidates ?? []);
        setAddError('Multiple Solana token candidates were found. Choose the exact token to add.');
        return;
      }
      setAddInput('');
      loadWatchlist();
    } catch (err: unknown) {
      const response = (err as { response?: { data?: { message?: unknown; error?: unknown } | unknown } }).response;
      const responseData = response?.data;
      const payload = typeof responseData === 'object' && responseData !== null && 'message' in responseData
        ? (responseData as { message?: unknown; error?: unknown }).message ?? (responseData as { error?: unknown }).error ?? responseData
        : responseData;
      if (typeof payload === 'object' && payload !== null && (payload as { code?: string }).code === 'TOKEN_SYMBOL_AMBIGUOUS' && Array.isArray((payload as { candidates?: unknown }).candidates)) {
        setTokenCandidates((payload as { candidates: TokenCandidate[] }).candidates);
        setAddError('Multiple Solana token candidates were found. Choose the exact token to add.');
      } else {
        setAddError(typeof payload === 'string' ? payload : 'Failed to add token to watchlist.');
      }
    }
  };

  const handleCandidateAdd = async (candidate: TokenCandidate) => {
    await watchlistApi.add(candidate.address, candidate.symbol);
    setTokenCandidates([]);
    setAddError('');
    setAddInput('');
    loadWatchlist();
  };

  const handleRemove = async (id: string) => {
    try {
      await watchlistApi.remove(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      setAddError('Failed to remove token from watchlist.');
    }
  };

  const handleToggleAlert = async (id: string) => {
    try {
      await watchlistApi.toggleAlert(id);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, alertEnabled: !i.alertEnabled } : i)),
      );
    } catch {
      setAddError('Failed to update alert setting.');
    }
  };

  const handleRescan = async (item: WatchlistItem) => {
    setScanning(item.id);
    try {
      await scanApi.create(item.tokenAddress);
      loadWatchlist();
    } catch {
      setAddError('Failed to rescan watchlist token.');
    } finally {
      setScanning(null);
    }
  };

  const getRiskColor = (score: number) => {
    if (score >= 75) return '#ff4757';
    if (score >= 50) return '#ff6b81';
    if (score >= 30) return '#eccc68';
    return '#2ed573';
  };

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1
          style={{
            fontSize: 'var(--text-3xl)',
            fontWeight: 900,
            marginBottom: 'var(--space-2)',
          }}
        >
          <Eye size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 'var(--space-3)' }} />
          Watchlist
        </h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)' }}>
          Monitor tokens and get alerts when risk levels change
        </p>
      </motion.div>

      {/* Add Token */}
      <motion.form
        onSubmit={handleAdd}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        style={{ marginBottom: 'var(--space-6)' }}
      >
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <input
            className="scan-input"
            placeholder="Paste token address to watch..."
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary">
            <Plus size={16} /> Add
          </button>
        </div>
        {addError && (
          <div style={{ marginTop: 'var(--space-3)', color: 'var(--color-warning)', fontSize: 'var(--text-sm)' }}>
             {addError}
          </div>
        )}
        {tokenCandidates.length > 0 && (
          <div className="card" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)' }}>
            <div style={{ fontWeight: 800, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
              Choose the exact token
            </div>
            <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
              {tokenCandidates.map((candidate) => (
                <button
                  key={`${candidate.address}-${candidate.url ?? ''}`}
                  type="button"
                  onClick={() => handleCandidateAdd(candidate)}
                  style={{
                    textAlign: 'left', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-primary)', cursor: 'pointer',
                  }}
                >
                  <strong>{candidate.symbol ?? 'UNKNOWN'} - {candidate.name ?? 'Unnamed token'}</strong>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                    {candidate.address}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                    Liquidity: ${Math.round(candidate.liquidityUsd ?? 0).toLocaleString()}
                    {candidate.volume24h != null ? `  24h volume: $${Math.round(candidate.volume24h).toLocaleString()}` : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.form>

      {/* Watchlist Items */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="card"
      >
        {loading ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
            <div className="skeleton" style={{ width: '100%', height: 60, marginBottom: 'var(--space-3)' }} />
            <div className="skeleton" style={{ width: '100%', height: 60 }} />
          </div>
        ) : items.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: 'var(--space-12)',
              color: 'var(--color-text-muted)',
            }}
          >
            <Eye size={48} style={{ marginBottom: 'var(--space-4)', opacity: 0.3 }} />
            <p>No tokens in your watchlist yet.</p>
            <p style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
              Add a token address above or use "Add to Watchlist" from scan results.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <AnimatePresence>
              {items.map((item, idx) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: idx * 0.05 }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-4)',
                    borderBottom:
                      idx < items.length - 1 ? '1px solid var(--color-border)' : 'none',
                    transition: 'background var(--transition-fast)',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--color-bg-secondary)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  {/* Token Info */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      cursor: 'pointer',
                      flex: 1,
                    }}
                    onClick={() => navigate('/scan', { state: { input: item.tokenAddress } })}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: item.lastScan
                          ? getRiskColor(item.lastScan.finalScore)
                          : 'var(--color-text-muted)',
                        boxShadow: item.lastScan
                          ? `0 0 8px ${getRiskColor(item.lastScan.finalScore)}`
                          : 'none',
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                        {item.tokenSymbol ?? item.tokenAddress.slice(0, 12) + '...'}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--color-text-muted)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {item.tokenAddress.slice(0, 16)}...
                      </div>
                    </div>
                  </div>

                  {/* Score */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-6)',
                    }}
                  >
                    {item.lastScan ? (
                      <div style={{ textAlign: 'right' }}>
                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 800,
                            fontSize: 'var(--text-lg)',
                            color: getRiskColor(item.lastScan.finalScore),
                          }}
                        >
                          {item.lastScan.finalScore.toFixed(1)}
                        </div>
                        <div
                          style={{
                            fontSize: '9px',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {new Date(item.lastScan.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    ) : (
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        Not scanned
                      </span>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: 'var(--space-2)' }}
                        title="Rescan"
                        onClick={() => handleRescan(item)}
                        disabled={scanning === item.id}
                      >
                        <RefreshCw
                          size={14}
                          style={{
                            animation:
                              scanning === item.id ? 'spin 1s linear infinite' : 'none',
                          }}
                        />
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: 'var(--space-2)' }}
                        title={item.alertEnabled ? 'Mute alerts' : 'Enable alerts'}
                        onClick={() => handleToggleAlert(item.id)}
                      >
                        {item.alertEnabled ? (
                          <Bell size={14} style={{ color: 'var(--color-safe)' }} />
                        ) : (
                          <BellOff size={14} />
                        )}
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: 'var(--space-2)' }}
                        title="Remove"
                        onClick={() => handleRemove(item.id)}
                      >
                        <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default Watchlist;

