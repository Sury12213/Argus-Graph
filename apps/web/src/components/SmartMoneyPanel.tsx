import { motion, AnimatePresence } from 'framer-motion';

interface WhaleActivity {
  wallet: string;
  action: 'BUY' | 'SELL';
  amount: number;
  timestamp: number;
}

interface TopHolder {
  address: string;
  percentage: number;
  label: string;
  is_alpha?: boolean;
  net_flow?: number;
}

interface SmartMoneyPanelProps {
  data: {
    smart_money_score: number;
    signal?: string;
    // Net flow
    net_flow_pct?: number;
    net_flow_direction?: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL';
    whale_buy_txns?: number;
    whale_sell_txns?: number;
    // Alpha
    alpha_wallets_holding?: boolean;
    alpha_wallet_addresses?: string[];
    // Stealth
    stealth_accumulation?: boolean;
    coordinated_wallets?: number;
    // Dev
    dev_holding_pct?: number;
    dev_dump_detected?: boolean;
    dev_net_sold_pct?: number;
    // Concentration
    whale_concentration?: number;
    distribution_grade?: string;
    // Activity
    whale_activity?: WhaleActivity[];
    // Legacy
    inflow_count: number;
    outflow_count: number;
    smart_wallets_buying: string[];
    smart_wallets_selling: string[];
    top_holders_detail?: TopHolder[];
  } | null;
}

const SIGNAL_CONFIG: Record<string, { color: string; bg: string; border: string; icon: string; label: string }> = {
  ACCUMULATION_OBSERVED: { color: '#2ed573', bg: 'rgba(46,213,115,0.10)', border: 'rgba(46,213,115,0.30)', icon: '*', label: 'BUY PRESSURE OBSERVED' },
  DISTRIBUTION_RISK: { color: '#ff4757', bg: 'rgba(255,71,87,0.10)', border: 'rgba(255,71,87,0.30)', icon: '-', label: 'DISTRIBUTION RISK' },
  DEV_OR_WHALE_EXIT_RISK: { color: '#ff4757', bg: 'rgba(255,71,87,0.10)', border: 'rgba(255,71,87,0.30)', icon: '-', label: 'DEV / WHALE EXIT RISK' },
  NO_RELIABLE_SIGNAL: { color: '#ffa502', bg: 'rgba(255,165,2,0.10)', border: 'rgba(255,165,2,0.30)', icon: '*', label: 'NO RELIABLE SIGNAL' },
  ALPHA: { color: '#2ed573', bg: 'rgba(46,213,115,0.10)', border: 'rgba(46,213,115,0.30)', icon: '*', label: 'WATCHLIST WALLET HOLDING' },
  BULLISH: { color: '#2ed573', bg: 'rgba(46,213,115,0.10)', border: 'rgba(46,213,115,0.30)', icon: '*', label: 'BUY PRESSURE OBSERVED' },
  BEARISH: { color: '#ff4757', bg: 'rgba(255,71,87,0.10)', border: 'rgba(255,71,87,0.30)', icon: '-', label: 'DISTRIBUTION RISK' },
  NEUTRAL: { color: '#ffa502', bg: 'rgba(255,165,2,0.10)', border: 'rgba(255,165,2,0.30)', icon: '*', label: 'NO RELIABLE SIGNAL' },
};

const SmartMoneyPanel = ({ data }: SmartMoneyPanelProps) => {
  if (!data) return null;

  const score = data.smart_money_score;
  const signalKey = score >= 65 ? 'DISTRIBUTION_RISK' : data.signal ?? 'NO_RELIABLE_SIGNAL';
  const sig = SIGNAL_CONFIG[signalKey] ?? SIGNAL_CONFIG.NO_RELIABLE_SIGNAL;
  const scoreColor = score >= 70 ? '#ff4757' : score >= 40 ? '#ffa502' : '#2ed573';
  const direction = data.net_flow_direction ?? 'NEUTRAL';
  const grade = data.distribution_grade ?? '?';
  const gradeColor: Record<string, string> = { A: '#2ed573', B: '#7bed9f', C: '#eccc68', D: '#ffa502', F: '#ff4757' };

  const buyTxns = data.whale_buy_txns ?? data.inflow_count ?? 0;
  const sellTxns = data.whale_sell_txns ?? data.outflow_count ?? 0;
  const totalTxns = buyTxns + sellTxns;
  const buyPct = totalTxns > 0 ? (buyTxns / totalTxns) * 100 : 50;
  const visibleTopHolders = data.top_holders_detail ?? [];

  return (
    <div className="card" style={{ padding: 'var(--space-4)' }}>

      {/*  Header  */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 4 }}>Holder Flow Risk</div>
          <div style={{ fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>WHALE FLOW ANALYSIS</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: 'var(--text-xl)', color: scoreColor }}>{score}</div>
          <div style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>RISK SCORE</div>
        </div>
      </div>

      {/*  Signal Banner  */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', marginBottom: 'var(--space-3)',
          background: sig.bg, border: `1px solid ${sig.border}`,
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{sig.icon}</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: sig.color, letterSpacing: '0.08em' }}>{sig.label}</div>
            <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 1 }}>
              {direction === 'ACCUMULATING' && 'Large holders show net inflow'}
              {direction === 'DISTRIBUTING' && 'Large holders show net outflow'}
              {direction === 'NEUTRAL' && 'No reliable holder-flow edge'}
            </div>
          </div>
        </div>
        {data.net_flow_pct !== undefined && (
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14,
            color: data.net_flow_pct >= 0 ? '#2ed573' : '#ff4757' }}>
            {data.net_flow_pct >= 0 ? '+' : ''}{data.net_flow_pct.toFixed(1)}%
          </div>
        )}
      </motion.div>

      {/*  Alpha Wallet Alert  */}
      <AnimatePresence>
        {data.alpha_wallets_holding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              padding: '8px 12px', marginBottom: 'var(--space-3)',
              background: 'rgba(167,139,250,0.08)',
              border: '1px solid rgba(167,139,250,0.4)',
              borderRadius: 'var(--radius-md)',
              fontSize: 10, color: '#a78bfa',
            }}
          >
            <strong>{data.alpha_wallet_addresses?.length} tracked wallet(s)</strong> detected holding this token
          </motion.div>
        )}
      </AnimatePresence>

      {/*  Dev Dump Warning  */}
      <AnimatePresence>
        {data.dev_dump_detected && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            style={{
              padding: '8px 12px', marginBottom: 'var(--space-3)',
              background: 'rgba(255,71,87,0.08)',
              border: '1px solid rgba(255,71,87,0.4)',
              borderRadius: 'var(--radius-md)',
              fontSize: 10, color: '#ff4757',
            }}
          >
            <strong>Dev wallet distribution risk.</strong> Creator wallet shows outbound activity
          </motion.div>
        )}
      </AnimatePresence>

      {/*  Stealth Accumulation Warning  */}
      <AnimatePresence>
        {data.stealth_accumulation && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            style={{
              padding: '8px 12px', marginBottom: 'var(--space-3)',
              background: 'rgba(255,165,2,0.08)',
              border: '1px solid rgba(255,165,2,0.3)',
              borderRadius: 'var(--radius-md)',
              fontSize: 10, color: '#ffa502',
            }}
          >
            <strong>Coordinated wallet risk.</strong> {data.coordinated_wallets} similarly sized wallets detected (possible wallet farm)
          </motion.div>
        )}
      </AnimatePresence>

      {/*  Buy vs Sell Flow Bar  */}
      {totalTxns > 0 && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 6, color: 'var(--color-text-muted)' }}>
            <span>WHALE TRANSACTIONS (last 100)</span>
            <span>{totalTxns} total</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
            <div style={{ textAlign: 'center', padding: '6px', background: 'rgba(46,213,115,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(46,213,115,0.15)' }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#2ed573', fontFamily: 'var(--font-mono)' }}>{buyTxns}</div>
              <div style={{ fontSize: 9, color: '#2ed573' }}> BUY</div>
            </div>
            <div style={{ textAlign: 'center', padding: '6px', background: 'rgba(255,71,87,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,71,87,0.15)' }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#ff4757', fontFamily: 'var(--font-mono)' }}>{sellTxns}</div>
              <div style={{ fontSize: 9, color: '#ff4757' }}> SELL</div>
            </div>
          </div>
          {/* Flow bar */}
          <div style={{ height: 5, background: 'rgba(255,71,87,0.25)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${buyPct}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              style={{ height: '100%', background: 'linear-gradient(90deg, #2ed573, #7bed9f)', borderRadius: 'var(--radius-full)' }}
            />
          </div>
        </div>
      )}

      {/*  Top Holders  */}
      {visibleTopHolders.length > 0 && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <div style={{ fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 8 }}>TOP HOLDERS</div>
          {visibleTopHolders.map((h, i) => {
            const flowDir = (h.net_flow ?? 0) > 0 ? '-' : (h.net_flow ?? 0) < 0 ? '-' : '-';
            const flowColor = (h.net_flow ?? 0) > 0 ? '#2ed573' : (h.net_flow ?? 0) < 0 ? '#ff4757' : 'var(--color-text-muted)';
            return (
              <motion.div
                key={h.address}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 8px',
                  marginBottom: 3,
                  background: h.is_alpha ? 'rgba(167,139,250,0.06)' : 'rgba(255,255,255,0.02)',
                  border: h.is_alpha ? '1px solid rgba(167,139,250,0.2)' : '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 10,
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
                  {h.address.slice(0, 5)}...{h.address.slice(-4)}
                </span>
                <span style={{ fontSize: 8, color: h.is_alpha ? '#a78bfa' : 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                  {h.label}
                </span>
                <span style={{ fontSize: 11, color: flowColor, fontWeight: 700 }}>{flowDir}</span>
                <span style={{
                  fontWeight: 800, fontSize: 10,
                  color: h.percentage > 15 ? '#ff4757' : h.percentage > 5 ? '#ffa502' : '#2ed573',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {h.percentage.toFixed(1)}%
                </span>
              </motion.div>
            );
          })}
        </div>
      )}

      {/*  Stats Row  */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <div style={{ textAlign: 'center', padding: '6px 4px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: gradeColor[grade] ?? '#9aa0b0' }}>{grade}</div>
          <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>DISTRIB.</div>
        </div>
        <div style={{ textAlign: 'center', padding: '6px 4px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: (data.whale_concentration ?? 0) > 50 ? '#ff4757' : '#2ed573', fontFamily: 'var(--font-mono)' }}>
            {(data.whale_concentration ?? 0).toFixed(0)}%
          </div>
          <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>TOP 5</div>
        </div>
        <div style={{ textAlign: 'center', padding: '6px 4px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: (data.dev_holding_pct ?? 0) > 5 ? '#ff4757' : '#2ed573', fontFamily: 'var(--font-mono)' }}>
            {(data.dev_holding_pct ?? 0).toFixed(1)}%
          </div>
          <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>DEV HOLD</div>
        </div>
      </div>
    </div>
  );
};

export default SmartMoneyPanel;

