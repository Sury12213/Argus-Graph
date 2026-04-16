import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Shield, AlertTriangle, Loader, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { scanApi } from '../services/api';
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

const ScanPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isScanning, setIsScanning, setCurrentScan, currentScan } = useScanStore();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    cluster: true,
    velocity: true,
    smartMoney: true,
    social: true,
  });

  // Auto-fill from navigation state (quick scan from dashboard)
  useEffect(() => {
    const stateInput = (location.state as any)?.input;
    if (stateInput) {
      setInput(stateInput);
      handleScan(stateInput);
    }
  }, [location.state]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleScan = async (scanInput?: string) => {
    const query = scanInput || input;
    if (!query.trim()) return;

    setIsScanning(true);
    setError('');
    setScanResult(null);

    try {
      const { data } = await scanApi.create(query);
      const result = data.data;
      setScanResult(result);
      setCurrentScan(result);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Scan failed. Make sure the API server is running.');
      // Use mock result for demo
      setScanResult(getMockResult(query));
    } finally {
      setIsScanning(false);
    }
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
  const SectionHeader = ({ id, icon, title, subtitle }: { id: string; icon: string; title: string; subtitle: string }) => (
    <button
      onClick={() => toggleSection(id)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
        padding: 'var(--space-3) 0', background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--color-text-primary)', marginBottom: expandedSections[id] ? 'var(--space-3)' : 0,
        borderBottom: expandedSections[id] ? '1px solid var(--color-border)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ textAlign: 'left' }}>
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
              placeholder='e.g. "scan $RUGME", "mua 1 SOL $MEME", or paste token address...'
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
          ⚠️ {error} — Showing demo results.
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
              <span>🧬 Cluster</span>
              <span>🐦 Velocity</span>
              <span>💎 Smart Money</span>
              <span>📡 Social</span>
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
                      {scanResult.token?.symbol ?? 'Token'} — {scanResult.decision?.decision}
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
                  { label: '🧬 Cluster Risk', key: 'cluster_risk', desc: 'Wallet cluster & graph analysis' },
                  { label: '🐦 Velocity Score', key: 'velocity_score', desc: 'Tweet & holder growth rate' },
                  { label: '💎 Smart Money', key: 'smart_money', desc: 'Whale & alpha wallet signals' },
                  { label: '⚙️ Basic On-chain', key: 'basic_onchain', desc: 'LP lock, mint authority, age' },
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

            {/* ═══ ENGINE DEEP DIVE PANELS ═══ */}

            {/* Cluster Graph */}
            <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)' }}>
              <SectionHeader id="cluster" icon="🕸️" title="Wallet Cluster Graph" subtitle="Interactive network visualization — drag nodes, scroll to zoom" />
              {expandedSections.cluster && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.3 }}>
                  <ClusterGraph data={scanResult.engines?.cluster?.graph_data ?? null} />
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
              <SectionHeader id="velocity" icon="📊" title="Velocity Analysis" subtitle="Tweet & holder growth rate with bot detection" />
              {expandedSections.velocity && scanResult.engines?.velocity && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.3 }}>
                  <VelocityGauge
                    tweetVelocity={scanResult.engines.velocity.tweet_velocity}
                    holderMomentum={scanResult.engines.velocity.holder_momentum}
                    flags={scanResult.engines.velocity.flags}
                    snapshots={scanResult.engines.velocity.snapshots}
                  />
                </motion.div>
              )}
            </div>

            {/* Smart Money + Social side by side */}
            <div className="grid grid-2" style={{ marginBottom: 'var(--space-6)' }}>
              <div>
                <SectionHeader id="smartMoney" icon="💎" title="Smart Money" subtitle="Alpha wallet tracking" />
                {expandedSections.smartMoney && (
                  <SmartMoneyPanel data={scanResult.engines?.smart_money ?? null} />
                )}
              </div>
              <div>
                <SectionHeader id="social" icon="📡" title="Social Intel" subtitle="Sentiment & bot analysis" />
                {expandedSections.social && (
                  <SocialPanel data={scanResult.engines?.social ?? null} />
                )}
              </div>
            </div>

            {/* Metadata */}
            <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
              <h3 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Scan Metadata</h3>
              <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                <span>⏱ {scanResult.metadata?.scan_time_ms ?? '~150'}ms</span>
                <span>🏷 {scanResult.token?.symbol}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                  {scanResult.token?.address?.slice(0, 12)}...
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Mock result for demo when API is not running
function getMockResult(input: string) {
  const isScam = input.toLowerCase().includes('rugme') || input.toLowerCase().includes('meme');
  const isSafe = input.toLowerCase().includes('safu');

  const mockEngines = {
    cluster: {
      cluster_risk: isScam ? 85 : isSafe ? 5 : 35,
      clusters: isScam ? [
        { cluster_id: 'C_01', funding_source: 'DevWallet...9999', member_count: 15, risk_level: 'CRITICAL' },
      ] : [],
      circular_trades: isScam ? [{ path: ['ClusterA_01', 'ClusterA_02', 'ClusterA_03', 'ClusterA_01'], depth: 3 }] : [],
      graph_data: {
        nodes: isScam ? [
          { id: 'DevWallet', label: 'DevWal...9999', type: 'deployer', risk: 'critical', cluster_id: null, holding_pct: 40, size: 18 },
          ...Array.from({ length: 6 }, (_, i) => ({
            id: `Cluster_${i}`, label: `Clstr_${String(i).padStart(2, '0')}`, type: 'cluster' as const,
            risk: 'high' as const, cluster_id: 'C_01', holding_pct: 7.5 - i, size: 12,
          })),
        ] : [
          { id: 'LegitDev', label: 'Legit...3333', type: 'normal' as const, risk: 'low' as const, cluster_id: null, holding_pct: 5, size: 12 },
          { id: 'LP_Pool', label: 'Raydium LP', type: 'lp_pool' as const, risk: 'low' as const, cluster_id: null, holding_pct: 50, size: 16 },
        ],
        links: isScam ? [
          ...Array.from({ length: 6 }, (_, i) => ({
            source: 'DevWallet', target: `Cluster_${i}`, amount: 50000000, type: 'transfer' as const, is_circular: false, strength: 0.8,
          })),
          { source: 'Cluster_0', target: 'Cluster_1', amount: 25000000, type: 'transfer' as const, is_circular: true, strength: 0.5 },
          { source: 'Cluster_1', target: 'Cluster_2', amount: 25000000, type: 'transfer' as const, is_circular: true, strength: 0.5 },
          { source: 'Cluster_2', target: 'Cluster_0', amount: 25000000, type: 'swap' as const, is_circular: true, strength: 0.5 },
        ] : [
          { source: 'LegitDev', target: 'LP_Pool', amount: 250000000, type: 'transfer' as const, is_circular: false, strength: 1 },
        ],
      },
    },
    velocity: {
      velocity_score: isScam ? 72 : isSafe ? 0 : 40,
      tweet_velocity: isScam
        ? { growth_rate: 260, unique_user_rate: 25, bot_ratio: 10.4 }
        : { growth_rate: 15, unique_user_rate: 16.7, bot_ratio: 0.9 },
      holder_momentum: isScam
        ? { growth_rate: 12.5, is_declining: true }
        : { growth_rate: 4.2, is_declining: false },
      flags: isScam
        ? [{ type: 'BOT_PUMP', severity: 'HIGH', description: 'Tweet count grew 260% but unique users barely changed.' }]
        : [{ type: 'HEALTHY', severity: 'LOW', description: 'Organic growth detected.' }],
      snapshots: {
        tweets: [
          { timestamp: Date.now() - 600000, count: isScam ? 50 : 2000, unique_users: isScam ? 12 : 1800 },
          { timestamp: Date.now() - 300000, count: isScam ? 180 : 2150, unique_users: isScam ? 14 : 1950 },
          { timestamp: Date.now(), count: isScam ? 350 : 2300, unique_users: isScam ? 15 : 2100 },
        ],
        holders: [
          { timestamp: Date.now() - 600000, count: isScam ? 40 : 12000 },
          { timestamp: Date.now() - 300000, count: isScam ? 42 : 12250 },
          { timestamp: Date.now(), count: isScam ? 45 : 12500 },
        ],
      },
    },
    smart_money: {
      smart_money_score: isScam ? 70 : 20,
      inflow_count: isScam ? 0 : 2,
      outflow_count: isScam ? 1 : 0,
      smart_wallets_buying: isScam ? [] : ['SmartWhale_01', 'SmartSniper_01'],
      smart_wallets_selling: isScam ? ['SmartWhale_02'] : [],
      signal: isScam ? 'BEARISH' : 'BULLISH',
    },
    social: {
      social_score: isScam ? 65 : 15,
      sentiment: isScam ? 'mixed' : 'positive',
      bot_ratio: isScam ? 0.7 : 0.05,
      activity_level: isScam ? 'viral' : 'moderate',
      tweet_count: isScam ? 350 : 2300,
      unique_users: isScam ? 15 : 2100,
      trending_rank: isScam ? 3 : null,
    },
  };

  if (isScam) {
    return {
      token: { symbol: '$RUGME', name: 'RugMe Token', address: 'ScamToken111...' },
      scores: { final: 78.5, risk_level: 'CRITICAL', cluster_risk: 85, velocity_score: 72, smart_money: 70, basic_onchain: 85 },
      decision: { decision: 'BLOCKED', reason: 'Risk score (78.5) exceeds your maximum threshold (50).' },
      explanation: '⚠️ Cảnh báo! 70% volume hiện tại đến từ một cụm 15 ví nhận tiền từ cùng một ví deployer. Tốc độ tăng holder đang giảm so với 5 phút trước. Tweet tăng 260% nhưng chỉ có 2 users mới → Bot Pump. Lệnh bị CHẶN theo cài đặt rủi ro.',
      engines: mockEngines,
      metadata: { scan_time_ms: 156 },
    };
  }

  if (isSafe) {
    return {
      token: { symbol: '$SAFU', name: 'SafuCoin', address: 'SafeToken222...' },
      scores: { final: 12.5, risk_level: 'LOW', cluster_risk: 5, velocity_score: 0, smart_money: 20, basic_onchain: 0 },
      decision: { decision: 'APPROVED', reason: 'Risk score (12.5) is within your acceptable range.' },
      explanation: '✅ Token an toàn. LP locked 95%, mint authority revoked, 12,500 holders, organic growth. 2 Smart Wallets đang hold.',
      engines: mockEngines,
      metadata: { scan_time_ms: 142 },
    };
  }

  return {
    token: { symbol: '$HMMMM', name: 'Suspicious Meme', address: 'MidToken333...' },
    scores: { final: 43.2, risk_level: 'MEDIUM', cluster_risk: 35, velocity_score: 40, smart_money: 60, basic_onchain: 35 },
    decision: { decision: 'WARNING', reason: 'Risk score (43.2) is approaching your threshold (50).' },
    explanation: '⚠️ Thận trọng. LP locked 60% nhưng freeze authority chưa revoked.',
    engines: mockEngines,
    metadata: { scan_time_ms: 163 },
  };
}

export default ScanPage;
