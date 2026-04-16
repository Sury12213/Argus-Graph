import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Shield, Activity, TrendingUp, AlertTriangle, Clock } from 'lucide-react';
import { useScanStore } from '../stores';
import { scanApi } from '../services/api';

const Dashboard = () => {
  const navigate = useNavigate();
  const { scanHistory, setScanHistory } = useScanStore();
  const [scanInput, setScanInput] = useState('');

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const { data } = await scanApi.getHistory(10);
      setScanHistory(data.data ?? []);
    } catch {
      // API might not be running yet, use mock data
      setScanHistory([]);
    }
  };

  const handleQuickScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (scanInput.trim()) {
      navigate('/scan', { state: { input: scanInput } });
    }
  };

  const getRiskColor = (score: number) => {
    if (score >= 75) return 'var(--color-critical)';
    if (score >= 50) return 'var(--color-danger)';
    if (score >= 30) return 'var(--color-warning)';
    return 'var(--color-safe)';
  };

  const getRiskBadge = (score: number) => {
    if (score >= 75) return 'badge-critical';
    if (score >= 50) return 'badge-danger';
    if (score >= 30) return 'badge-warning';
    return 'badge-safe';
  };

  const getRiskLabel = (score: number) => {
    if (score >= 75) return 'CRITICAL';
    if (score >= 50) return 'HIGH';
    if (score >= 30) return 'MEDIUM';
    return 'LOW';
  };

  return (
    <div>
      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ marginBottom: 'var(--space-8)' }}
      >
        <h1 style={{
          fontSize: 'var(--text-3xl)',
          fontWeight: 900,
          marginBottom: 'var(--space-2)',
        }}>
          🛡️ Guardian Dashboard
        </h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Proactive surveillance for your Solana investments
        </p>
      </motion.div>

      {/* Quick Scan Input */}
      <motion.form
        onSubmit={handleQuickScan}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        style={{ marginBottom: 'var(--space-8)' }}
      >
        <div className="scan-input-wrapper">
          <Search size={20} className="scan-input-icon" />
          <input
            className="scan-input"
            placeholder='Scan any token — e.g. "audit $RUGME" or paste a token address...'
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-lg">
            <Search size={16} />
            Scan
          </button>
        </div>
      </motion.form>

      {/* Stats Grid */}
      <motion.div
        className="grid grid-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        style={{ marginBottom: 'var(--space-8)' }}
      >
        <div className="stat-card">
          <div className="stat-label">Total Scans</div>
          <div className="stat-value" style={{ color: 'var(--color-primary-light)' }}>
            {scanHistory.length}
          </div>
          <div className="stat-change positive">All time</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Threats Blocked</div>
          <div className="stat-value" style={{ color: 'var(--color-danger)' }}>
            {scanHistory.filter((s: any) => s.decision === 'BLOCKED').length}
          </div>
          <div className="stat-change negative">
            <AlertTriangle size={12} /> Protected
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Safe Trades</div>
          <div className="stat-value" style={{ color: 'var(--color-safe)' }}>
            {scanHistory.filter((s: any) => s.decision === 'APPROVED').length}
          </div>
          <div className="stat-change positive">✓ Verified</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Risk Score</div>
          <div className="stat-value">
            {scanHistory.length > 0
              ? (scanHistory.reduce((a: number, b: any) => a + (b.finalScore ?? 0), 0) / scanHistory.length).toFixed(1)
              : '—'}
          </div>
          <div className="stat-change">Out of 100</div>
        </div>
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        className="grid grid-3"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        style={{ marginBottom: 'var(--space-8)' }}
      >
        <button
          className="card"
          onClick={() => navigate('/scan', { state: { input: 'scan $RUGME' } })}
          style={{ cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <div style={{
              width: 40, height: 40,
              background: 'var(--color-danger-bg)',
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AlertTriangle size={20} style={{ color: 'var(--color-danger)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>Demo: Scam Token</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>$RUGME — See Guardian in action</div>
            </div>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
            Experience the "Guardian Moment" — watch Argus detect wallet clusters, bot pumps, and block the trade.
          </p>
        </button>

        <button
          className="card"
          onClick={() => navigate('/scan', { state: { input: 'scan $SAFU' } })}
          style={{ cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <div style={{
              width: 40, height: 40,
              background: 'var(--color-safe-bg)',
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Shield size={20} style={{ color: 'var(--color-safe)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>Demo: Safe Token</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>$SAFU — Healthy growth</div>
            </div>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
            See how a legitimate token with organic growth and smart money interest passes the Guardian check.
          </p>
        </button>

        <button
          className="card"
          onClick={() => navigate('/scan', { state: { input: 'scan $HMMMM' } })}
          style={{ cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <div style={{
              width: 40, height: 40,
              background: 'var(--color-warning-bg)',
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Activity size={20} style={{ color: 'var(--color-warning)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>Demo: Suspicious</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>$HMMMM — Proceed with caution</div>
            </div>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
            A medium-risk token with mixed signals — some LP locked but freeze authority remains.
          </p>
        </button>
      </motion.div>

      {/* Recent Scans */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <Clock size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
              Recent Scans
            </h2>
          </div>
          {scanHistory.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: 'var(--space-12)',
              color: 'var(--color-text-muted)',
            }}>
              <Search size={40} style={{ marginBottom: 'var(--space-4)', opacity: 0.3 }} />
              <p>No scans yet. Try one of the demo tokens above!</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {scanHistory.map((scan: any) => (
                <div
                  key={scan.id}
                  onClick={() => navigate(`/scan/${scan.id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg-secondary)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                    border: '1px solid transparent',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-border-hover)';
                    e.currentTarget.style.background = 'var(--color-bg-tertiary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'transparent';
                    e.currentTarget.style.background = 'var(--color-bg-secondary)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{
                      width: 10, height: 10,
                      borderRadius: '50%',
                      background: getRiskColor(scan.finalScore),
                      boxShadow: `0 0 8px ${getRiskColor(scan.finalScore)}`,
                    }} />
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{scan.tokenSymbol ?? scan.tokenAddress?.slice(0, 8)}</span>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginLeft: 'var(--space-2)' }}>
                        {scan.tokenName}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      color: getRiskColor(scan.finalScore),
                    }}>
                      {scan.finalScore?.toFixed(1)}
                    </span>
                    <span className={`badge ${getRiskBadge(scan.finalScore)}`}>
                      {scan.decision}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default Dashboard;
