import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock3, History, Network, ScanSearch, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, EmptyState, MetricCard } from '../components/ui';
import { useScanStore } from '../stores';
import { scanApi } from '../services/api';

interface DashboardScan { id?: string; decision?: string; finalScore?: number; createdAt?: string; tokenSymbol?: string; tokenName?: string | null; tokenAddress?: string; }

const riskTone = (score = 0) => score >= 75 ? 'critical' : score >= 50 ? 'danger' : score >= 30 ? 'warning' : 'success';

const Dashboard = () => {
  const navigate = useNavigate();
  const { scanHistory, setScanHistory } = useScanStore();
  const scans = scanHistory as DashboardScan[];
  const [scanInput, setScanInput] = useState('');

  const loadHistory = useCallback(async () => {
    try { const { data } = await scanApi.getHistory(10); setScanHistory(data.data ?? []); }
    catch { setScanHistory([]); }
  }, [setScanHistory]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const stats = useMemo(() => {
    const blocked = scans.filter((scan) => scan.decision === 'BLOCKED').length;
    const approved = scans.filter((scan) => scan.decision === 'APPROVED').length;
    const avg = scans.length ? scans.reduce((sum, scan) => sum + (scan.finalScore ?? 0), 0) / scans.length : undefined;
    return { blocked, approved, avg };
  }, [scans]);

  const handleQuickScan = (event: React.FormEvent) => {
    event.preventDefault();
    if (scanInput.trim()) navigate('/scan', { state: { input: scanInput } });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Command center</div>
          <h1 className="page-title">Intelligence overview</h1>
          <p className="page-subtitle">Monitor scan activity, blocked exposure, and wallet risk posture from one professional console.</p>
        </div>
      </div>

      <form onSubmit={handleQuickScan} className="panel panel-pad">
        <div className="scan-input-wrapper">
          <ScanSearch size={20} className="scan-input-icon" />
          <input className="scan-input" placeholder="Paste Solana mint or wallet address" value={scanInput} onChange={(e) => setScanInput(e.target.value)} />
          <Button type="submit" variant="primary" size="lg" icon={<ScanSearch size={16} />}>Scan</Button>
        </div>
      </form>

      <div className="grid grid-4">
        <MetricCard label="Total scans" value={scans.length} helperText="Recent history window" icon={<History size={18} />} />
        <MetricCard label="Blocked threats" value={stats.blocked} helperText="Hard-block decisions" icon={<AlertTriangle size={18} />} />
        <MetricCard label="Approved scans" value={stats.approved} helperText="Low-risk decisions" icon={<ShieldCheck size={18} />} />
        <MetricCard label="Average risk" value={stats.avg === undefined ? '-' : stats.avg.toFixed(1)} helperText="Weighted score / 100" icon={<Network size={18} />} />
      </div>

      <div className="grid grid-3">
        <Card icon={<Network size={20} />} title="Cluster analysis" description="Trace top holders, funding sources, and circular transfers with live Helius data."><div /></Card>
        <Card icon={<ShieldCheck size={20} />} title="Deterministic scoring" description="Final risk score uses engine weights, not language-model guesswork."><div /></Card>
        <Card icon={<AlertTriangle size={20} />} title="Partial data aware" description="Unavailable providers surface warnings instead of fake fallback data."><div /></Card>
      </div>

      <Card icon={<Clock3 size={20} />} title="Recent scans" description="Open any report to inspect cluster, velocity, social, and execution signals.">
        {scans.length === 0 ? (
          <EmptyState icon={<ScanSearch size={36} />} title="No scans yet" description="Paste a Solana address above to start live analysis." />
        ) : (
          <div className="scan-list">
            {scans.map((scan) => (
              <button key={scan.id} className="scan-row" onClick={() => navigate(`/scan/${scan.id}`)}>
                <div>
                  <strong>{scan.tokenSymbol ?? scan.tokenAddress?.slice(0, 8) ?? 'Unknown token'}</strong>
                  <span>{scan.tokenName ?? scan.tokenAddress}</span>
                </div>
                <div className="scan-row__meta">
                  <span>{scan.finalScore?.toFixed(1) ?? '-'}</span>
                  <Badge tone={riskTone(scan.finalScore) as never}>{scan.decision ?? 'UNKNOWN'}</Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default Dashboard;

