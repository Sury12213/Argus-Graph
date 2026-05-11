import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clock, Filter, Search, Shield, AlertTriangle, Activity } from 'lucide-react';
import { scanApi } from '../services/api';

interface HistoryScan {
  id: string;
  tokenAddress: string;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  decision: string;
  finalScore: number;
  clusterRisk?: number | null;
  velocityScore?: number | null;
  smartMoney?: number | null;
  basicOnchain?: number | null;
  createdAt: string;
}

const ScanHistory = () => {
  const navigate = useNavigate();
  const [scans, setScans] = useState<HistoryScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadScans();
  }, []);

  const loadScans = async () => {
    try {
      const { data } = await scanApi.getHistory(100);
      setScans(data.data ?? []);
    } catch {
      setScans([]);
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

  const getDecisionIcon = (decision: string) => {
    switch (decision) {
      case 'BLOCKED': return <AlertTriangle size={14} style={{ color: '#ff4757' }} />;
      case 'WARNING': return <Activity size={14} style={{ color: '#ffa502' }} />;
      default: return <Shield size={14} style={{ color: '#2ed573' }} />;
    }
  };

  const metricValue = (value?: number | null) => (
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(0) : '-'
  );

  const filtered = scans.filter((s) => {
    if (filter !== 'ALL' && s.decision !== filter) return false;
    if (search && !(s.tokenSymbol || '').toLowerCase().includes(search.toLowerCase())
        && !(s.tokenAddress || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: scans.length,
    blocked: scans.filter((s) => s.decision === 'BLOCKED').length,
    warning: scans.filter((s) => s.decision === 'WARNING').length,
    approved: scans.filter((s) => s.decision === 'APPROVED').length,
  };

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 900, marginBottom: 'var(--space-2)' }}>
          <Clock size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 'var(--space-3)' }} />
          Scan History
        </h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)' }}>
          All your token risk assessments
        </p>
      </motion.div>

      {/* Stats Bar */}
      <motion.div
        className="grid grid-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        style={{ marginBottom: 'var(--space-6)' }}
      >
        {[
          { label: 'Total', value: stats.total, color: 'var(--color-primary-light)' },
          { label: 'Blocked', value: stats.blocked, color: '#ff4757' },
          { label: 'Warning', value: stats.warning, color: '#ffa502' },
          { label: 'Approved', value: stats.approved, color: '#2ed573' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color }}>{value}</div>
          </div>
        ))}
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        style={{
          display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)',
          flexWrap: 'wrap', alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Filter size={14} style={{ color: 'var(--color-text-muted)', marginTop: 2 }} />
          {['ALL', 'BLOCKED', 'WARNING', 'APPROVED'].map((f) => (
            <button
              key={f}
              className={`btn ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-3)' }}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input
            className="input"
            placeholder="Search by symbol or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 36, width: '100%' }}
          />
        </div>
      </motion.div>

      {/* Scans Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="card"
      >
        {loading ? (
          <div style={{ padding: 'var(--space-8)' }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 48, marginBottom: 'var(--space-2)' }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
            <Clock size={48} style={{ marginBottom: 'var(--space-4)', opacity: 0.3 }} />
            <p>{scans.length === 0 ? 'No scans yet. Go scan a token!' : 'No scans match your filters.'}</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textTransform: 'uppercase' as const }}>
                  <th style={{ padding: 'var(--space-3)', textAlign: 'left' }}>Token</th>
                  <th style={{ padding: 'var(--space-3)', textAlign: 'right' }}>Score</th>
                  <th style={{ padding: 'var(--space-3)', textAlign: 'right' }}>Cluster</th>
                  <th style={{ padding: 'var(--space-3)', textAlign: 'right' }}>Velocity</th>
                  <th style={{ padding: 'var(--space-3)', textAlign: 'right' }}>Smart</th>
                  <th style={{ padding: 'var(--space-3)', textAlign: 'right' }}>On-chain</th>
                  <th style={{ padding: 'var(--space-3)', textAlign: 'center' }}>Decision</th>
                  <th style={{ padding: 'var(--space-3)', textAlign: 'right' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((scan, idx) => (
                  <tr
                    key={scan.id}
                    onClick={() => navigate(`/scan/${scan.id}`)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: idx < filtered.length - 1 ? '1px solid var(--color-border)' : 'none',
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-secondary)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: getRiskColor(scan.finalScore),
                        boxShadow: `0 0 6px ${getRiskColor(scan.finalScore)}`,
                        flexShrink: 0,
                      }} />
                      <div>
                        <span style={{ fontWeight: 600 }}>{scan.tokenSymbol ?? 'Unknown'}</span>
                        {scan.tokenName && (
                          <span style={{ marginLeft: 'var(--space-2)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                            {scan.tokenName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: 'var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: getRiskColor(scan.finalScore) }}>
                      {scan.finalScore?.toFixed(1)}
                    </td>
                    <td style={{ padding: 'var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
                      {metricValue(scan.clusterRisk)}
                    </td>
                    <td style={{ padding: 'var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
                      {metricValue(scan.velocityScore)}
                    </td>
                    <td style={{ padding: 'var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
                      {metricValue(scan.smartMoney)}
                    </td>
                    <td style={{ padding: 'var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
                      {metricValue(scan.basicOnchain)}
                    </td>
                    <td style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {getDecisionIcon(scan.decision)}
                        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>{scan.decision}</span>
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-3)', textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                      {new Date(scan.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default ScanHistory;

