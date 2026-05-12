import { useEffect, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { ShieldCheck, Wallet, Zap } from 'lucide-react';
import { guardianApi, userApi } from '../services/api';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

interface GuardianExecutionPanelProps {
  scanId?: string;
  tokenAddress: string;
  tokenSymbol?: string | null;
  decision: string;
  riskScore?: number;
}

interface GuardianExecution {
  id: string;
  status: string;
  quoteResponse?: { outAmount?: string; priceImpactPct?: string };
  slippageBps: number;
  swapTransaction?: string;
  transactionSignature?: string;
}

const errorMessage = (err: unknown, fallback: string) => {
  const response = (err as { response?: { data?: { message?: { message?: string } | string } } }).response;
  const message = response?.data?.message;
  return typeof message === 'object' ? message.message ?? fallback : message ?? (err as Error)?.message ?? fallback;
};

const statusLabel = (status: string) => {
  const labels: Record<string, string> = {
    QUOTE_READY: 'Ready for wallet approval',
    AWAITING_SIGNATURE: 'Ready for wallet approval',
    SUBMITTED: 'Submitted',
    CONFIRMED: 'Confirmed',
    FAILED: 'Failed',
    EXPIRED: 'Expired',
  };
  return labels[status] ?? status;
};

const formatSolOutput = (outAmount?: string) => {
  if (!outAmount) return 'Unknown';
  const sol = Number(outAmount) / LAMPORTS_PER_SOL;
  return `${sol.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL`;
};

const GuardianExecutionPanel = ({ scanId, tokenAddress, tokenSymbol, decision, riskScore }: GuardianExecutionPanelProps) => {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [amount, setAmount] = useState('');
  const [tokenDecimals, setTokenDecimals] = useState<number | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState('');
  const [execution, setExecution] = useState<GuardianExecution | null>(null);
  const [swapTransaction, setSwapTransaction] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoExitEnabled, setAutoExitEnabled] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const amountRaw = useMemo(() => {
    if (tokenDecimals == null || !/^\d+(\.\d*)?$/.test(amount.trim())) return '';
    const [whole, fraction = ''] = amount.trim().split('.');
    const paddedFraction = fraction.padEnd(tokenDecimals, '0').slice(0, tokenDecimals);
    const raw = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, '');
    return raw === '0' ? '' : raw;
  }, [amount, tokenDecimals]);
  const amountNumber = Number(amount || 0);
  const hasEnoughBalance = tokenBalance == null || amountNumber <= tokenBalance;
  const canPrepare = autoExitEnabled && connected && publicKey && amountRaw && hasEnoughBalance;
  const highRisk = (riskScore ?? 0) >= 75 || ['BLOCKED', 'WARNING'].includes(decision);
  const shortWallet = useMemo(() => {
    const value = publicKey?.toBase58();
    return value ? `${value.slice(0, 4)}...${value.slice(-4)}` : '';
  }, [publicKey]);
  const formatAmount = (value: number) => value.toFixed(6).replace(/\.0+$|(?<=\.\d*?)0+$/g, '');
  const setBalancePercent = (percent: number) => {
    if (tokenBalance == null) return;
    setAmount(formatAmount(tokenBalance * percent));
  };

  useEffect(() => {
    let active = true;
    userApi.getProfile()
      .then(({ data }) => {
        if (!active) return;
        setAutoExitEnabled(Boolean(data.data?.autoExitEnabled));
      })
      .catch(() => {
        if (active) setAutoExitEnabled(false);
      })
      .finally(() => {
        if (active) setSettingsLoaded(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!connected || !publicKey) {
      setTokenDecimals(null);
      setTokenBalance(null);
      setBalanceError('');
      return;
    }

    let active = true;
    setTokenDecimals(null);
    setTokenBalance(null);
    setBalanceError('');
    guardianApi.getTokenBalance(tokenAddress)
      .then(({ data }) => {
        if (!active) return;
        setTokenDecimals(data.data.decimals);
        setTokenBalance(data.data.balanceUi);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setTokenDecimals(0);
        setTokenBalance(0);
        setBalanceError(errorMessage(err, 'Failed to load wallet token balance.'));
      });

    return () => { active = false; };
  }, [connected, publicKey, tokenAddress]);

  useEffect(() => {
    if (!execution?.id || !['SUBMITTED', 'AWAITING_SIGNATURE'].includes(execution.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const { data } = await guardianApi.getExecution(execution.id);
        setExecution(data.data);
      } catch (err: unknown) {
        setError(errorMessage(err, 'Failed to refresh transaction status.'));
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [execution?.id, execution?.status]);

  const reviewExitSwap = async () => {
    if (!canPrepare) return;
    setLoading(true);
    setError('');
    setSwapTransaction('');
    try {
      const quote = await guardianApi.quote({
        scanId,
        inputMint: tokenAddress,
        outputMint: SOL_MINT,
        amountRaw: amountRaw.trim(),
        tokenAddress,
      });
      setExecution(quote.data.data);

      const built = await guardianApi.buildSwap(quote.data.data.id);
      setExecution(built.data.data);
      setSwapTransaction(built.data.data.swapTransaction);
      setStatus('Exit route ready. Nothing has been sold yet. Approve in your wallet only if the quote looks acceptable.');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to prepare exit swap.'));
    } finally {
      setLoading(false);
    }
  };

  const signAndSend = async () => {
    if (!swapTransaction || !execution?.id) return;
    setLoading(true);
    setError('');
    try {
      const bytes = Uint8Array.from(atob(swapTransaction), (char) => char.charCodeAt(0));
      const transaction = VersionedTransaction.deserialize(bytes);
      const signature = await sendTransaction(transaction, connection);
      const { data } = await guardianApi.markSubmitted(execution.id, signature);
      setExecution(data.data);
      setStatus('Transaction submitted. Waiting for confirmation.');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Wallet rejected or failed to send the transaction.'));
    } finally {
      setLoading(false);
    }
  };

  if (!settingsLoaded) return null;

  if (!autoExitEnabled) return null;

  return (
    <div className="card" style={{ marginBottom: 'var(--space-6)', borderColor: 'rgba(124, 58, 237, 0.35)' }}>
      <div className="card-header">
        <h3 className="card-title">
          <ShieldCheck size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
          Guardian One-Click Exit
        </h3>
        <span className="badge badge-warning">Wallet approval required</span>
      </div>

      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', lineHeight: 1.6, marginBottom: 'var(--space-4)' }}>
        Argus detects critical risk and prepares an emergency Jupiter exit for {tokenSymbol ?? 'this token'}. You stay in control: every sell requires one wallet approval.
      </p>

      {!connected ? (
        <div style={{ color: 'var(--color-warning)', fontSize: 'var(--text-sm)' }}>
          Connect your wallet to prepare a Jupiter swap.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 700 }}>
              Amount to sell
            </label>
            <input
              className="input"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
              placeholder={`Example: 1.5 ${tokenSymbol ?? 'tokens'}`}
            />
            <div style={{ fontSize: 'var(--text-xs)', color: tokenBalance === 0 || !hasEnoughBalance ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
              {tokenBalance != null
                ? `Wallet balance: ${tokenBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tokenSymbol ?? 'tokens'}${tokenDecimals != null ? `  Decimals: ${tokenDecimals}` : ''}`
                : 'Loading wallet token balance...'}
              {!hasEnoughBalance ? '  Amount exceeds balance' : ''}
              {balanceError ? `  ${balanceError}` : ''}
            </div>
            {tokenBalance != null && tokenBalance > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[0.25, 0.5, 1].map((percent) => (
                  <button key={percent} className="btn btn-secondary" type="button" style={{ padding: '4px 10px', fontSize: 'var(--text-xs)' }} onClick={() => setBalancePercent(percent)}>
                    Sell {Math.round(percent * 100)}%
                  </button>
                ))}
              </div>
            )}
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Wallet: {shortWallet}  Decision: {decision}{riskScore != null ? `  Score: ${riskScore.toFixed(1)}` : ''}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: highRisk ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
              {highRisk
                ? 'Critical risk detected. Prepare an exit route now and approve only if the quote looks acceptable.'
                : 'Optional exit route. Use this if you want to reduce exposure.'}
            </div>
          </div>

          {execution?.quoteResponse && (
            <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)' }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Emergency exit review</div>
              <div>Estimated output: {formatSolOutput(execution.quoteResponse.outAmount)}</div>
              {execution.quoteResponse.priceImpactPct != null && <div>Price impact: {execution.quoteResponse.priceImpactPct}%</div>}
              <div>Slippage: {(execution.slippageBps / 100).toFixed(2)}%</div>
              <div>Status: {statusLabel(execution.status)}</div>
              <div style={{ marginTop: 8, color: 'var(--color-warning)' }}>
                No swap is submitted until you approve it in your wallet.
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            {!swapTransaction ? (
              <button className="btn btn-primary" type="button" disabled={!canPrepare || loading} onClick={reviewExitSwap}>
                <Zap size={16} /> {loading ? 'Preparing exit...' : 'Prepare emergency exit'}
              </button>
            ) : !['SUBMITTED', 'CONFIRMED', 'FAILED', 'EXPIRED'].includes(execution?.status ?? '') ? (
              <button className="btn btn-primary" type="button" disabled={loading} onClick={signAndSend}>
                <Wallet size={16} /> {loading ? 'Waiting for wallet...' : 'Approve emergency sell'}
              </button>
            ) : (
              <button className="btn btn-secondary" type="button" disabled>
                {statusLabel(execution?.status ?? '')}
              </button>
            )}
          </div>

          {status && <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>{status}</div>}
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)' }}>{error}</div>}
          {execution?.transactionSignature && (
            <a href={`https://solscan.io/tx/${execution.transactionSignature}`} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary-light)', fontSize: 'var(--text-sm)' }}>
              View transaction on Solscan
            </a>
          )}
        </div>
      )}
    </div>
  );
};

export default GuardianExecutionPanel;

