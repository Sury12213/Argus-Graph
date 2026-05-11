/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Shield, AlertTriangle, Clock, Hash } from 'lucide-react';
import { scanApi } from '../services/api';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
} from 'recharts';
import ClusterGraph from '../components/ClusterGraph';
import VelocityGauge from '../components/VelocityGauge';
import SmartMoneyPanel from '../components/SmartMoneyPanel';
import SocialPanel from '../components/SocialPanel';
import GuardianExecutionPanel from '../components/GuardianExecutionPanel';
import { AiSummaryPanel } from '../components/AiSummaryPanel';

type ScanDetail = any;

const toScore = (value: unknown) => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const formatMetric = (value: unknown, suffix = '') => {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value.toLocaleString()}${suffix}`;
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return 'Unavailable';
};

const lpStatus = (metadata: any) => {
  if (metadata?.lp_status && metadata.lp_status !== 'unknown') {
    const parts = [`${metadata.lp_status.toUpperCase()}  secure ${Number(metadata.lp_lock_percentage ?? 0).toFixed(1)}%`];
    if (typeof metadata.lp_locked_pct === 'number') parts.push(`locked ${metadata.lp_locked_pct.toFixed(1)}%`);
    if (typeof metadata.lp_burn_pct === 'number') parts.push(`burned ${metadata.lp_burn_pct.toFixed(1)}%`);
    return parts.join('  ');
  }
  const risks = (metadata?.rug_risks ?? []).join(' ').toLowerCase();
  const hasLpRisk = risks.includes('liquidity') || risks.includes('lp') || risks.includes('lock') || risks.includes('rug');
  if (metadata?.lp_locked === false && hasLpRisk) return 'Unlocked / Risk detected';
  if (metadata?.lp_locked === true) return 'Locked';
  return 'Unavailable';
};

const ScanResult = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [scan, setScan] = useState<ScanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) loadScan(id);
  }, [id]);

  const loadScan = async (scanId: string) => {
    setLoading(true);
    try {
      const { data } = await scanApi.getById(scanId);
      setScan(data.data);
    } catch {
      setError('Scan not found or access denied.');
    } finally {
      setLoading(false);
    }
  };

  const getRiskColor = (score: number) => {
    if (score >= 75) return '#ff4757';
    if (score >= 50) return '#ff6b81';
    if (score >= 30) return '#eccc68';
    return '#2ed573';
  };

  const getRiskBadgeClass = (decision: string) => {
    switch (decision) {
      case 'BLOCKED': return 'badge-danger';
      case 'WARNING': return 'badge-warning';
      default: return 'badge-safe';
    }
  };

  // Loading state
  if (loading) {
    return (
      <div style={{ padding: 'var(--space-16)', textAlign: 'center' }}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          style={{
            width: 48, height: 48, borderRadius: '50%', margin: '0 auto var(--space-4)',
            border: '3px solid var(--color-bg-tertiary)', borderTopColor: 'var(--color-primary)',
          }}
        />
        <p style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
          Loading scan result...
        </p>
      </div>
    );
  }

  // Error state
  if (error || !scan) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <AlertTriangle size={48} style={{ color: 'var(--color-warning)', margin: '0 auto var(--space-4)' }} />
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
          {error || 'Scan not found'}
        </h2>
        <button className="btn btn-primary" onClick={() => navigate('/scan')}>
          <ArrowLeft size={16} /> Back to Scanner
        </button>
      </div>
    );
  }

  // Parse rawData for engine details (stored scan from DB)
  const rawData = scan.rawData ?? {};
  const engines = {
    cluster: rawData.cluster ?? null,
    velocity: rawData.velocity ?? null,
    smart_money: rawData.smartMoney ?? null,
    social: rawData.social ?? null,
  };

  const tokenMetadata = rawData.tokenMetadata ?? {};
  const scores = {
    final: toScore(scan.finalScore),
    cluster_risk: toScore(scan.clusterRisk),
    velocity_score: toScore(scan.velocityScore),
    smart_money: toScore(scan.smartMoney),
    basic_onchain: toScore(scan.basicOnchain ?? rawData.scoring?.breakdown?.basic_onchain),
    risk_level: rawData.scoring?.risk_level ?? (toScore(scan.finalScore) >= 75 ? 'CRITICAL' : toScore(scan.finalScore) >= 50 ? 'HIGH' : toScore(scan.finalScore) >= 30 ? 'MEDIUM' : 'LOW'),
  };

  const radarData = [
    { metric: 'Cluster Risk', value: scores.cluster_risk, fullMark: 100 },
    { metric: 'Velocity', value: scores.velocity_score, fullMark: 100 },
    { metric: 'Smart Money', value: scores.smart_money, fullMark: 100 },
    { metric: 'On-chain', value: scores.basic_onchain, fullMark: 100 },
  ];
  const riskDrivers = rawData.riskDrivers ?? [];

  return (
    <div>
      {/* Back Button */}
      <button
        className="btn btn-ghost"
        onClick={() => navigate(-1)}
        style={{ marginBottom: 'var(--space-4)' }}
      >
        <ArrowLeft size={16} /> Back
      </button>

      {/* Decision Banner */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          padding: 'var(--space-6)',
          borderRadius: 'var(--radius-lg)',
          marginBottom: 'var(--space-6)',
          border: '1px solid',
          borderColor: scan.decision === 'BLOCKED'
            ? 'rgba(255,71,87,0.3)' : scan.decision === 'WARNING'
            ? 'rgba(255,179,71,0.3)' : 'rgba(0,233,158,0.3)',
          background: scan.decision === 'BLOCKED'
            ? 'var(--color-danger-bg)' : scan.decision === 'WARNING'
            ? 'var(--color-warning-bg)' : 'var(--color-safe-bg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              {scan.decision === 'BLOCKED' ? (
                <AlertTriangle size={24} style={{ color: 'var(--color-danger)' }} />
              ) : (
                <Shield size={24} style={{ color: 'var(--color-safe)' }} />
              )}
              <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 900 }}>
                {scan.tokenSymbol ?? scan.tokenAddress?.slice(0, 12)}
              </h1>
              <span className={`badge ${getRiskBadgeClass(scan.decision)}`}>
                {scan.decision}
              </span>
              <span className={`badge ${getRiskBadgeClass(scan.decision)}`} style={{ opacity: 0.7 }}>
                {scores.risk_level}
              </span>
            </div>
            {scan.tokenName && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
                {scan.tokenName}
              </p>
            )}
            {scan.aiExplanation && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', maxWidth: 650, lineHeight: 1.6 }}>
                {scan.aiExplanation}
              </p>
            )}
          </div>
          <div style={{ textAlign: 'center', minWidth: 80 }}>
            <div style={{
              fontSize: 'var(--text-4xl)', fontWeight: 900, fontFamily: 'var(--font-mono)',
              color: getRiskColor(scores.final),
              textShadow: `0 0 20px ${getRiskColor(scores.final)}`,
            }}>
              {scores.final.toFixed(1)}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>RISK SCORE</div>
          </div>
        </div>
      </motion.div>

      {/* Scan Info bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        style={{
          display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-6)',
          fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Hash size={12} /> {scan.id?.slice(0, 8)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} /> {new Date(scan.createdAt).toLocaleString()}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {scan.tokenAddress}
        </span>
      </motion.div>

      <AiSummaryPanel summary={scan.ai_summary ?? rawData.aiSummary} explanation={scan.aiExplanation} />

      {scan.tokenAddress && (
        <GuardianExecutionPanel
          scanId={scan.id}
          tokenAddress={scan.tokenAddress}
          tokenSymbol={scan.tokenSymbol}
          decision={scan.decision}
          riskScore={scores.final}
        />
      )}

      {riskDrivers.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h3 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Top Risk Drivers</h3>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            {riskDrivers.slice(0, 5).map((driver: any, index: number) => (
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

      {rawData.scoring?.trader || rawData.traderScoring ? (() => {
        const trader = rawData.scoring?.trader ?? rawData.traderScoring;
        return (
          <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)' }}>
            <h3 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Trader Action</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
              {[
                ['Action', trader.action],
                ['Risk', trader.risk_score],
                ['Opportunity', trader.opportunity_score],
                ['Rug', trader.categories?.rug_risk],
                ['Dump', trader.categories?.dump_risk],
                ['Entry', trader.categories?.entry_risk],
              ].map(([label, value]) => (
                <div key={label as string} style={{ padding: 'var(--space-3)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontWeight: 800, color: typeof value === 'number' ? getRiskColor(value) : 'var(--color-text-primary)' }}>{typeof value === 'number' ? value.toFixed(1) : value}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })() : null}

      {/* Radar + Score Cards */}
      <div className="grid grid-2" style={{ marginBottom: 'var(--space-6)' }}>
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="card">
          <h3 className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Risk Radar</h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--color-border)" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} />
              <Radar name="Risk" dataKey="value" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.25} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {[
            { label: ' Cluster Risk', value: scores.cluster_risk, weight: '30%' },
            { label: ' Velocity Score', value: scores.velocity_score, weight: '30%' },
            { label: ' Smart Money', value: scores.smart_money, weight: '20%' },
            { label: ' Basic On-chain', value: scores.basic_onchain, weight: '20%' },
          ].map(({ label, value, weight }) => (
            <div key={label} className="card" style={{ padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{weight}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 'var(--text-lg)', color: getRiskColor(value) }}>
                    {value.toFixed(0)}
                  </span>
                </div>
              </div>
              <div style={{ width: '100%', height: 6, background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${value}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  style={{ height: '100%', background: getRiskColor(value), borderRadius: 'var(--radius-full)', boxShadow: `0 0 8px ${getRiskColor(value)}` }}
                />
              </div>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Cluster Graph */}
      {engines.cluster && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)' }}
        >
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
             Wallet Cluster Network
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 400 }}>
              {engines.cluster.total_unique_wallets} wallets  {engines.cluster.clusters?.length ?? 0} clusters  {engines.cluster.circular_trades?.length ?? 0} circular trades
            </span>
          </h3>
          <ClusterGraph data={engines.cluster.graph_data ?? null} />
        </motion.div>
      )}

      {/* Velocity */}
      {engines.velocity && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)' }}
        >
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
             Velocity Analysis
          </h3>
          <VelocityGauge
            tweetVelocity={engines.velocity.tweet_velocity}
            holderMomentum={engines.velocity.holder_momentum}
            flags={engines.velocity.flags}
            snapshots={engines.velocity.snapshots}
          />
        </motion.div>
      )}

      {/* Smart Money + Social */}
      <div className="grid grid-2" style={{ marginBottom: 'var(--space-6)' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <SmartMoneyPanel data={engines.smart_money} />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <SocialPanel data={engines.social} />
        </motion.div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <h3 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Scan Metadata</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
          {[
            ['Supply', formatMetric(tokenMetadata.supply)],
            ['LP lock', lpStatus(tokenMetadata)],
            ['Mint authority', tokenMetadata.mint_authority_revoked === true ? 'Revoked' : tokenMetadata.mint_authority_revoked === false ? 'Active' : 'Unavailable'],
            ['Freeze authority', tokenMetadata.freeze_authority_revoked === true ? 'Revoked' : tokenMetadata.freeze_authority_revoked === false ? 'Active' : 'Unavailable'],
            ['Created', tokenMetadata.created_at ? new Date(tokenMetadata.created_at).toLocaleString() : 'Unavailable'],
          ].map(([label, value]) => (
            <div key={label} style={{ padding: 'var(--space-3)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontWeight: 700, color: 'var(--color-text-secondary)', wordBreak: 'break-word' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ScanResult;


