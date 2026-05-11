/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Gem, Network, Radio, Search, Shield, AlertTriangle, Loader, Zap, ChevronDown, ChevronUp, Eye, ExternalLink } from 'lucide-react';
import { scanApi, watchlistApi } from '../services/api';
import { useScanStore } from '../stores';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts';
import ClusterGraph from '../components/ClusterGraph';
import VelocityGauge from '../components/VelocityGauge';
import SmartMoneyPanel from '../components/SmartMoneyPanel';
import SocialPanel from '../components/SocialPanel';
import ErrorBoundary from '../components/ErrorBoundary';
import GuardianExecutionPanel from '../components/GuardianExecutionPanel';
import { AiSummaryPanel } from '../components/AiSummaryPanel';

interface TokenCandidate {
  address: string;
  symbol?: string;
  name?: string;
  liquidityUsd?: number;
  volume24h?: number;
  url?: string;
}

type ScanResultData = any;

const responsePayload = (err: unknown) => {
  const response = (err as { response?: { data?: { message?: unknown; error?: unknown } | unknown } }).response;
  const responseData = response?.data;
  if (typeof responseData === 'object' && responseData !== null && 'message' in responseData) {
    return (responseData as { message?: unknown; error?: unknown }).message ?? (responseData as { error?: unknown }).error ?? responseData;
  }
  return responseData;
};

const ScanPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isScanning, setIsScanning, setCurrentScan } = useScanStore();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [scanResult, setScanResult] = useState<ScanResultData | null>(null);
  const [watchlistAdded, setWatchlistAdded] = useState(false);
  const autoScanKeyRef = useRef<string | null>(null);
  const inFlightScanRef = useRef(false);
  const [tokenCandidates, setTokenCandidates] = useState<TokenCandidate[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    cluster: true,
    velocity: true,
    smartMoney: true,
    social: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleScan = useCallback(async (scanInput?: string) => {
    const query = scanInput || input;
    if (!query.trim() || isScanning || inFlightScanRef.current) return;

    inFlightScanRef.current = true;
    setIsScanning(true);
    setError('');
    setScanResult(null);
    setTokenCandidates([]);

    try {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { data } = await scanApi.create(query, requestId);
      const result = data.data;
      setScanResult(result);
      setCurrentScan(result);
    } catch (err: unknown) {
      const payload = responsePayload(err);
      if (typeof payload === 'object' && payload !== null && (payload as { code?: string }).code === 'TOKEN_SYMBOL_AMBIGUOUS' && Array.isArray((payload as { candidates?: unknown }).candidates)) {
        setTokenCandidates((payload as { candidates: TokenCandidate[] }).candidates);
        setError('Multiple Solana token candidates were found. Choose the exact token to continue.');
      } else {
        setError(typeof payload === 'string' ? payload : 'Scan failed. Make sure the API server is running and required API keys are configured.');
      }
    } finally {
      inFlightScanRef.current = false;
      setIsScanning(false);
    }
  }, [input, isScanning, setCurrentScan, setIsScanning]);

  useEffect(() => {
    const stateInput = (location.state as { input?: string } | null)?.input;
    if (stateInput && autoScanKeyRef.current !== stateInput) {
      autoScanKeyRef.current = stateInput;
      setInput(stateInput);
      void handleScan(stateInput);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [handleScan, location.pathname, location.state, navigate]);

  const handleCandidateScan = (candidate: TokenCandidate) => {
    setInput(candidate.address);
    handleScan(candidate.address);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleScan();
  };

  const getRiskColor = (score: number) => {
    if (score >= 75) return 'var(--color-critical)';
    if (score >= 50) return 'var(--color-danger)';
    if (score >= 30) return 'var(--color-warning)';
    return 'var(--color-safe)';
  };

  const formatMetric = (value: unknown, suffix = '') => {
    if (typeof value === 'number' && Number.isFinite(value)) return `${value.toLocaleString()}${suffix}`;
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return 'Unavailable';
  };

  const lpStatus = (token: any) => {
    if (token?.lp_status && token.lp_status !== 'unknown') {
      const parts = [`${token.lp_status.toUpperCase()}  secure ${Number(token.lp_lock_percentage ?? 0).toFixed(1)}%`];
      if (typeof token.lp_locked_pct === 'number') parts.push(`locked ${token.lp_locked_pct.toFixed(1)}%`);
      if (typeof token.lp_burn_pct === 'number') parts.push(`burned ${token.lp_burn_pct.toFixed(1)}%`);
      return parts.join('  ');
    }
    const risks = (token?.rug_risks ?? []).join(' ').toLowerCase();
    const hasLpRisk = risks.includes('liquidity') || risks.includes('lp') || risks.includes('lock') || risks.includes('rug');
    if (token?.lp_locked === false && hasLpRisk) return 'Unlocked / Risk detected';
    if (token?.lp_locked === true) return 'Locked';
    return 'Unavailable';
  };

  const getRiskBadge = (decision: string) => {
    switch (decision) {
      case 'BLOCKED': return 'badge-danger';
      case 'WARNING': return 'badge-warning';
      default: return 'badge-safe';
    }
  };

  const radarData = scanResult ? [
    { metric: 'Cluster Risk', value: scanResult.scores?.cluster_risk ?? 0, fullMark: 100 },
    { metric: 'Velocity', value: scanResult.scores?.velocity_score ?? 0, fullMark: 100 },
    { metric: 'Smart Money', value: scanResult.scores?.smart_money ?? 0, fullMark: 100 },
    { metric: 'On-chain', value: scanResult.scores?.basic_onchain ?? 0, fullMark: 100 },
  ] : [];

  // Section header component
  const SectionHeader = ({ id, icon, title, subtitle }: { id: string; icon: ReactNode; title: string; subtitle: string }) => (
    <button
      onClick={() => toggleSection(id)}
      className="scan-section-toggle"
      style={{ marginBottom: expandedSections[id] ? 'var(--space-3)' : 0 }}
    >
      <div className="scan-section-toggle__title">
        <span className="icon-shell">{icon}</span>
        <div style={{ textAlign: 'left', minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{title}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{subtitle}</div>
        </div>
      </div>
      {expandedSections[id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
    </button>
  );

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 900, marginBottom: 'var(--space-2)' }}>
          <Search size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 'var(--space-3)' }} />
          Token Scanner
        </h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)' }}>
          Enter a token address, symbol, or natural language command
        </p>

        <form onSubmit={handleSubmit}>
          <div className="scan-input-wrapper" style={{ marginBottom: 'var(--space-8)' }}>
            <Search size={20} className="scan-input-icon" />
            <input
              className="scan-input"
              placeholder='Paste a Solana token mint address, e.g. "scan <mint-address>"...'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isScanning}
            />
            <button type="submit" className="btn btn-primary btn-lg" disabled={isScanning}>
              {isScanning ? <Loader size={16} className="spin" /> : <Zap size={16} />}
              {isScanning ? 'Scanning...' : 'Analyze'}
            </button>
          </div>
        </form>
      </motion.div>

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            padding: 'var(--space-4)',
            background: 'var(--color-warning-bg)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid rgba(255, 179, 71, 0.2)',
            marginBottom: 'var(--space-6)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-warning)',
          }}
        >
           {error}
        </motion.div>
      )}

      {tokenCandidates.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="card panel-pad"
          style={{ marginBottom: 'var(--space-6)' }}
        >
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 800, marginBottom: 'var(--space-3)' }}>
            Choose the exact token
          </h3>
          <div className="token-candidate-grid">
            {tokenCandidates.map((candidate) => (
              <button
                key={`${candidate.address}-${candidate.url ?? ''}`}
                type="button"
                onClick={() => handleCandidateScan(candidate)}
                className="token-candidate-card"
              >
                <div className="token-candidate-card__top">
                  <strong>{candidate.symbol ?? 'UNKNOWN'} - {candidate.name ?? 'Unnamed token'}</strong>
                  <span className="token-candidate-card__liquidity">
                    ${Math.round(candidate.liquidityUsd ?? 0).toLocaleString()} liquidity
                  </span>
                </div>
                <div className="token-candidate-card__address">
                  {candidate.address}
                </div>
                {candidate.volume24h != null && (
                  <div className="token-candidate-card__volume">
                    24h volume: ${Math.round(candidate.volume24h).toLocaleString()}
                  </div>
                )}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Scanning Animation */}
      <AnimatePresence>
        {isScanning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--space-16)',
              gap: 'var(--space-4)',
            }}
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              style={{
                width: 60, height: 60,
                borderRadius: '50%',
                border: '3px solid var(--color-bg-tertiary)',
                borderTopColor: 'var(--color-primary)',
              }}
            />
            <p style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
              Running parallel engines...
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              <span> Cluster</span>
              <span> Velocity</span>
              <span> Smart Money</span>
              <span> Social</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scan Result */}
      <AnimatePresence>
        {scanResult && !isScanning && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* Decision Banner */}
            <div style={{
              padding: 'var(--space-6)',
              borderRadius: 'var(--radius-lg)',
              marginBottom: 'var(--space-6)',
              border: '1px solid',
              borderColor: scanResult.decision?.decision === 'BLOCKED'
                ? 'rgba(255, 71, 87, 0.3)' : scanResult.decision?.decision === 'WARNING'
                ? 'rgba(255, 179, 71, 0.3)' : 'rgba(0, 233, 158, 0.3)',
              background: scanResult.decision?.decision === 'BLOCKED'
                ? 'var(--color-danger-bg)' : scanResult.decision?.decision === 'WARNING'
                ? 'var(--color-warning-bg)' : 'var(--color-safe-bg)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                    {scanResult.decision?.decision === 'BLOCKED' ? (
                      <AlertTriangle size={24} style={{ color: 'var(--color-danger)' }} />
                    ) : (
                      <Shield size={24} style={{ color: 'var(--color-safe)' }} />
                    )}
                    <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800 }}>
                      {scanResult.token?.symbol ?? 'Token'} - {scanResult.decision?.decision}
                    </h2>
                    <span className={`badge ${getRiskBadge(scanResult.decision?.decision)}`}>
                      {scanResult.scores?.risk_level}
                    </span>
                  </div>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', maxWidth: 600 }}>
                    {scanResult.explanation}
                  </p>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontSize: 'var(--text-4xl)',
                    fontWeight: 900,
                    fontFamily: 'var(--font-mono)',
                    color: getRiskColor(scanResult.scores?.final ?? 0),
                    textShadow: `0 0 20px ${getRiskColor(scanResult.scores?.final ?? 0)}`,
                  }}>
                    {scanResult.scores?.final?.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>RISK SCORE</div>
                </div>
              </div>
            </div>

            <AiSummaryPanel summary={scanResult.ai_summary} explanation={scanResult.explanation} />

            {scanResult.token?.address && (
              <GuardianExecutionPanel
                scanId={scanResult.id}
                tokenAddress={scanResult.token.address}
                tokenSymbol={scanResult.token.symbol}
                decision={scanResult.decision?.decision}
                riskScore={scanResult.scores?.final}
              />
            )}

            {scanResult.risk_drivers?.length > 0 && (
              <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
                <h3 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Top Risk Drivers</h3>
                <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                  {scanResult.risk_drivers.slice(0, 5).map((driver: any, index: number) => (
                    <div key={`${driver.category}-${index}`} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', padding: 'var(--space-3)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                      <span className={`badge ${driver.severity === 'critical' ? 'badge-danger' : driver.severity === 'high' ? 'badge-warning' : 'badge-safe'}`}>
                        {driver.severity}
                      </span>
                      <div style={{ fontWeight: 800, fontSize: 'var(--text-sm)' }}>{driver.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scanResult.scores?.trader && (
              <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)' }}>
                <h3 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Trader Action</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
                  {[
                    ['Action', scanResult.scores.trader.action],
                    ['Risk', scanResult.scores.trader.risk_score],
                    ['Opportunity', scanResult.scores.trader.opportunity_score],
                    ['Rug', scanResult.scores.trader.categories?.rug_risk],
                    ['Dump', scanResult.scores.trader.categories?.dump_risk],
                    ['Entry', scanResult.scores.trader.categories?.entry_risk],
                  ].map(([label, value]) => (
                    <div key={label as string} style={{ padding: 'var(--space-3)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontWeight: 800, color: typeof value === 'number' ? getRiskColor(value) : 'var(--color-text-primary)' }}>{typeof value === 'number' ? value.toFixed(1) : value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  try {
                    await watchlistApi.add(
                      scanResult.token?.address,
                      scanResult.token?.symbol,
                    );
                    setWatchlistAdded(true);
                    setTimeout(() => setWatchlistAdded(false), 3000);
                  } catch {
                    setError('Failed to add token to watchlist.');
                  }
                }}
                style={{ fontSize: 'var(--text-xs)' }}
              >
                <Eye size={14} />
                {watchlistAdded ? 'Saved: Added!' : 'Add to Watchlist'}
              </button>
              {scanResult.id && (
                <button
                  className="btn btn-ghost"
                  onClick={() => navigate(`/scan/${scanResult.id}`)}
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  <ExternalLink size={14} />
                  View Full Report
                </button>
              )}
            </div>

            {/* Score Breakdown: Radar + Score Cards */}
            <div className="grid grid-2" style={{ marginBottom: 'var(--space-6)' }}>
              {/* Radar Chart */}
              <div className="card">
                <h3 className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Risk Radar</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="var(--color-border)" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} />
                    <Radar
                      name="Risk"
                      dataKey="value"
                      stroke="var(--color-primary)"
                      fill="var(--color-primary)"
                      fillOpacity={0.25}
                      strokeWidth={2}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* Score Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {[
                  { label: ' Cluster Risk', key: 'cluster_risk', desc: 'Wallet cluster & graph analysis' },
                  { label: ' Velocity Score', key: 'velocity_score', desc: 'Tweet & holder growth rate' },
                  { label: ' Smart Money', key: 'smart_money', desc: 'Whale & alpha wallet signals' },
                  { label: ' Basic On-chain', key: 'basic_onchain', desc: 'LP lock, mint authority, age' },
                ].map(({ label, key, desc }) => {
                  const score = scanResult.scores?.[key] ?? 0;
                  return (
                    <div key={key} className="card" style={{ padding: 'var(--space-4)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{label}</span>
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 800,
                          fontSize: 'var(--text-lg)',
                          color: getRiskColor(score),
                        }}>
                          {score.toFixed(0)}
                        </span>
                      </div>
                      <div style={{
                        width: '100%', height: 6,
                        background: 'var(--color-bg-secondary)',
                        borderRadius: 'var(--radius-full)',
                        overflow: 'hidden',
                      }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${score}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          style={{
                            height: '100%',
                            background: getRiskColor(score),
                            borderRadius: 'var(--radius-full)',
                            boxShadow: `0 0 8px ${getRiskColor(score)}`,
                          }}
                        />
                      </div>
                      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>{desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/*  ENGINE DEEP DIVE PANELS  */}

            {/* Cluster Graph */}
            <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)' }}>
              <SectionHeader id="cluster" icon={<Network size={18} />} title="Wallet Cluster Graph" subtitle="Interactive network visualization - drag nodes, scroll to zoom" />
              {expandedSections.cluster && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.3 }}>
                  <ErrorBoundary name="Cluster Graph">
                    <ClusterGraph data={scanResult.engines?.cluster?.graph_data ?? null} />
                  </ErrorBoundary>
                  {scanResult.engines?.cluster?.clusters?.length > 0 && (
                    <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                      {scanResult.engines.cluster.clusters.map((c: any) => (
                        <span key={c.cluster_id} style={{
                          display: 'inline-block', marginRight: 'var(--space-2)', marginBottom: 'var(--space-1)',
                          padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                          background: c.risk_level === 'CRITICAL' ? 'rgba(255,71,87,0.15)' : 'rgba(255,165,2,0.15)',
                          color: c.risk_level === 'CRITICAL' ? '#ff4757' : '#ffa502',
                        }}>
                          {c.cluster_id}: {c.member_count} wallets ({c.risk_level})
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </div>

            {/* Velocity Analysis */}
            <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)' }}>
              <SectionHeader id="velocity" icon={<Activity size={18} />} title="Velocity Analysis" subtitle="Tweet & holder growth rate with bot detection" />
              {expandedSections.velocity && scanResult.engines?.velocity && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.3 }}>
                  <VelocityGauge
                    tweetVelocity={scanResult.engines.velocity.tweet_velocity}
                    holderMomentum={scanResult.engines.velocity.holder_momentum}
                    flags={scanResult.engines.velocity.flags}
                    snapshots={scanResult.engines.velocity.snapshots}
                    tweet_growth_rate={scanResult.engines.velocity.tweet_growth_rate}
                    tweet_unique_users={scanResult.engines.velocity.tweet_unique_users}
                    tweet_bot_ratio={scanResult.engines.velocity.tweet_bot_ratio}
                    tweet_is_bot_pump={scanResult.engines.velocity.tweet_is_bot_pump}
                    tx_count_h1={scanResult.engines.velocity.tx_count_h1}
                    price_change_h1={scanResult.engines.velocity.price_change_h1}
                    has_paid_boost={scanResult.engines.velocity.has_paid_boost}
                    sources={scanResult.engines.velocity.sources}
                    tweet_timeline={scanResult.engines.velocity.tweet_timeline}
                    dex_buy_timeline={scanResult.engines.velocity.dex_buy_timeline}
                    sentiment_shift={scanResult.engines.velocity.sentiment_shift}
                    sentiment_label={scanResult.engines.velocity.sentiment_label}
                    is_sentiment_crash={scanResult.engines.velocity.is_sentiment_crash}
                    kol_count={scanResult.engines.velocity.kol_count}
                    kol_names={scanResult.engines.velocity.kol_names}
                    is_organized_shill={scanResult.engines.velocity.is_organized_shill}
                    weighted_shill_reach={scanResult.engines.velocity.weighted_shill_reach}
                    shill_size={scanResult.engines.velocity.shill_size}
                    total_engagement={scanResult.engines.velocity.total_engagement}
                    avg_engagement_per_tweet={scanResult.engines.velocity.avg_engagement_per_tweet}
                    engagement_decay_pct={scanResult.engines.velocity.engagement_decay_pct}
                    is_engagement_dying={scanResult.engines.velocity.is_engagement_dying}
                    liquidity_ratio={scanResult.engines.velocity.liquidity_ratio}
                    is_flash_crash_risk={scanResult.engines.velocity.is_flash_crash_risk}
                    liquidity_usd={scanResult.engines.velocity.liquidity_usd}
                    v_pressure={scanResult.engines.velocity.v_pressure}
                    buy_volume_h1={scanResult.engines.velocity.buy_volume_h1}
                    sell_volume_h1={scanResult.engines.velocity.sell_volume_h1}
                    tg_group={scanResult.engines.velocity.tg_group}
                    tg_member_count={scanResult.engines.velocity.tg_member_count}
                    tg_member_growth_rate={scanResult.engines.velocity.tg_member_growth_rate}
                    tg_member_delta={scanResult.engines.velocity.tg_member_delta}
                    is_tg_surging={scanResult.engines.velocity.is_tg_surging}
                    is_tg_declining={scanResult.engines.velocity.is_tg_declining}
                    block_density_pct={scanResult.engines.velocity.block_density_pct}
                    consecutive_buy_blocks={scanResult.engines.velocity.consecutive_buy_blocks}
                    is_god_candle={scanResult.engines.velocity.is_god_candle}
                    ai_sentiment={scanResult.engines.velocity.ai_sentiment}
                    ai_confidence={scanResult.engines.velocity.ai_confidence}
                    ai_summary={scanResult.engines.velocity.ai_summary}
                    ai_sarcasm_detected={scanResult.engines.velocity.ai_sarcasm_detected}
                    ai_key_concerns={scanResult.engines.velocity.ai_key_concerns}
                  />
                </motion.div>
              )}
            </div>

            {/* Smart Money + Social side by side */}
            <div className="grid grid-2" style={{ marginBottom: 'var(--space-6)' }}>
              <div>
                <SectionHeader id="smartMoney" icon={<Gem size={18} />} title="Smart Money" subtitle="Alpha wallet tracking" />
                {expandedSections.smartMoney && (
                  <ErrorBoundary name="Smart Money">
                    <SmartMoneyPanel data={scanResult.engines?.smart_money ?? null} />
                  </ErrorBoundary>
                )}
              </div>
              <div>
                <SectionHeader id="social" icon={<Radio size={18} />} title="Social Intel" subtitle="Sentiment & bot analysis" />
                {expandedSections.social && (
                  <ErrorBoundary name="Social Panel">
                    <SocialPanel data={scanResult.engines?.social ?? null} />
                  </ErrorBoundary>
                )}
              </div>
            </div>

            {/* Metadata */}
            <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
              <h3 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Scan Metadata</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
                {[
                  ['Scan time', scanResult.metadata?.scan_time_ms ? `${scanResult.metadata.scan_time_ms}ms` : 'Unavailable'],
                  ['Supply', formatMetric(scanResult.token?.supply)],
                  ['LP lock', lpStatus(scanResult.token)],
                  ['Mint authority', scanResult.token?.mint_authority_revoked === true ? 'Revoked' : scanResult.token?.mint_authority_revoked === false ? 'Active' : 'Unavailable'],
                  ['Freeze authority', scanResult.token?.freeze_authority_revoked === true ? 'Revoked' : scanResult.token?.freeze_authority_revoked === false ? 'Active' : 'Unavailable'],
                  ['Created', scanResult.token?.created_at ? new Date(scanResult.token.created_at).toLocaleString() : 'Unavailable'],
                ].map(([label, value]) => (
                  <div key={label} style={{ padding: 'var(--space-3)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontWeight: 700, color: 'var(--color-text-secondary)', wordBreak: 'break-word' }}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 'var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                {scanResult.token?.address}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};


export default ScanPage;








