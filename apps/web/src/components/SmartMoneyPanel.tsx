import { motion } from 'framer-motion';

interface SmartMoneyPanelProps {
  data: {
    smart_money_score: number;
    inflow_count: number;
    outflow_count: number;
    smart_wallets_buying: string[];
    smart_wallets_selling: string[];
    signal: string;
  } | null;
}

const SmartMoneyPanel = ({ data }: SmartMoneyPanelProps) => {
  if (!data) return null;

  const inflowTotal = data.inflow_count + data.outflow_count;
  const inflowPct = inflowTotal > 0 ? (data.inflow_count / inflowTotal) * 100 : 50;

  return (
    <div className="card" style={{ padding: 'var(--space-4)' }}>
      <h3 style={{
        fontSize: 'var(--text-sm)', fontWeight: 700,
        marginBottom: 'var(--space-4)',
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      }}>
        💎 Smart Money Signals
        <span style={{
          fontSize: 'var(--text-xs)',
          padding: '2px 8px',
          borderRadius: 'var(--radius-full)',
          background: data.signal === 'BULLISH' ? 'rgba(46,213,115,0.15)' :
                      data.signal === 'BEARISH' ? 'rgba(255,71,87,0.15)' : 'rgba(255,255,255,0.08)',
          color: data.signal === 'BULLISH' ? '#2ed573' :
                 data.signal === 'BEARISH' ? '#ff4757' : 'var(--color-text-muted)',
        }}>
          {data.signal}
        </span>
      </h3>

      {/* Inflow / Outflow Bar */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', marginBottom: 4 }}>
          <span style={{ color: '#2ed573' }}>Buying ({data.inflow_count})</span>
          <span style={{ color: '#ff4757' }}>Selling ({data.outflow_count})</span>
        </div>
        <div style={{
          width: '100%', height: 8,
          background: 'rgba(255,71,87,0.3)',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
        }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${inflowPct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{
              height: '100%',
              background: 'linear-gradient(90deg, #2ed573, #7bed9f)',
              borderRadius: 'var(--radius-full)',
            }}
          />
        </div>
      </div>

      {/* Wallet lists */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
            🟢 Buying
          </div>
          {data.smart_wallets_buying.length === 0 ? (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>None</span>
          ) : (
            data.smart_wallets_buying.map((wallet, i) => (
              <motion.div
                key={wallet}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                style={{
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-mono)',
                  padding: '4px 8px',
                  background: 'rgba(46,213,115,0.08)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 4,
                  color: '#2ed573',
                }}
              >
                {wallet}
              </motion.div>
            ))
          )}
        </div>

        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
            🔴 Selling
          </div>
          {data.smart_wallets_selling.length === 0 ? (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>None</span>
          ) : (
            data.smart_wallets_selling.map((wallet, i) => (
              <motion.div
                key={wallet}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                style={{
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-mono)',
                  padding: '4px 8px',
                  background: 'rgba(255,71,87,0.08)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 4,
                  color: '#ff4757',
                }}
              >
                {wallet}
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default SmartMoneyPanel;
