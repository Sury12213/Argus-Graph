import { motion } from 'framer-motion';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart,
} from 'recharts';

interface VelocityGaugeProps {
  tweetVelocity: {
    growth_rate: number;
    unique_user_rate: number;
    bot_ratio: number;
  };
  holderMomentum: {
    growth_rate: number;
    is_declining: boolean;
  };
  flags: { type: string; severity: string; description: string }[];
  snapshots: {
    tweets: { timestamp: number; count: number; unique_users: number }[];
    holders: { timestamp: number; count: number }[];
  };
}

const VelocityGauge = ({ tweetVelocity, holderMomentum, flags, snapshots }: VelocityGaugeProps) => {
  const gaugeValue = Math.min(100, Math.max(0, tweetVelocity.growth_rate));
  const gaugeAngle = (gaugeValue / 100) * 180; // 0-180 degrees

  const getGaugeColor = (value: number) => {
    if (value >= 200) return '#ff4757';
    if (value >= 100) return '#ffa502';
    if (value >= 50) return '#eccc68';
    return '#2ed573';
  };

  const getFlagBadge = (type: string) => {
    switch (type) {
      case 'BOT_PUMP': return { color: '#ff4757', emoji: '🤖', bg: 'rgba(255,71,87,0.15)' };
      case 'DUMP_RISK': return { color: '#ffa502', emoji: '📉', bg: 'rgba(255,165,2,0.15)' };
      case 'HEALTHY': return { color: '#2ed573', emoji: '✅', bg: 'rgba(46,213,115,0.15)' };
      default: return { color: '#70a1ff', emoji: '❓', bg: 'rgba(112,161,255,0.15)' };
    }
  };

  // Format timeline data
  const tweetData = snapshots.tweets.map((s, i) => ({
    time: `T-${(snapshots.tweets.length - 1 - i) * 5}m`,
    tweets: s.count,
    users: s.unique_users,
  }));

  const holderData = snapshots.holders.map((s, i) => ({
    time: `T-${(snapshots.holders.length - 1 - i) * 5}m`,
    holders: s.count,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Gauge + Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        {/* Tweet Velocity Gauge */}
        <div className="card" style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
          <h4 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
            🐦 Tweet Velocity
          </h4>
          {/* SVG Gauge */}
          <svg viewBox="0 0 200 120" style={{ width: '100%', maxWidth: 220, margin: '0 auto' }}>
            {/* Background arc */}
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="12"
              strokeLinecap="round"
            />
            {/* Value arc */}
            <motion.path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke={getGaugeColor(tweetVelocity.growth_rate)}
              strokeWidth="12"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: Math.min(1, gaugeValue / 100) }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              style={{ filter: `drop-shadow(0 0 6px ${getGaugeColor(tweetVelocity.growth_rate)})` }}
            />
            {/* Needle */}
            <motion.line
              x1="100" y1="100"
              x2="100" y2="30"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              initial={{ rotate: -90 }}
              animate={{ rotate: gaugeAngle - 90 }}
              transition={{ duration: 1, ease: 'easeOut' }}
              style={{ transformOrigin: '100px 100px' }}
            />
            <circle cx="100" cy="100" r="5" fill="white" />
            {/* Value text */}
            <text x="100" y="95" textAnchor="middle" fill="white" fontSize="18" fontWeight="bold" fontFamily="var(--font-mono)">
              {tweetVelocity.growth_rate.toFixed(0)}%
            </text>
            <text x="100" y="115" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="9">
              GROWTH RATE
            </text>
            {/* Scale labels */}
            <text x="20" y="115" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8">0%</text>
            <text x="180" y="115" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8">100%+</text>
          </svg>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            Bot Ratio: <span style={{ color: tweetVelocity.bot_ratio > 5 ? '#ff4757' : '#2ed573', fontWeight: 700 }}>
              {tweetVelocity.bot_ratio.toFixed(1)}x
            </span>
          </div>
        </div>

        {/* Holder Momentum */}
        <div className="card" style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
          <h4 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
            👥 Holder Momentum
          </h4>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{
              fontSize: 'var(--text-3xl)', fontWeight: 900, fontFamily: 'var(--font-mono)',
              color: holderMomentum.is_declining ? '#ff4757' : holderMomentum.growth_rate > 5 ? '#2ed573' : '#eccc68',
              marginBottom: 'var(--space-2)',
            }}
          >
            {holderMomentum.growth_rate >= 0 ? '+' : ''}{holderMomentum.growth_rate.toFixed(1)}%
          </motion.div>
          <div style={{
            fontSize: 'var(--text-xs)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            display: 'inline-block',
            background: holderMomentum.is_declining ? 'rgba(255,71,87,0.15)' : 'rgba(46,213,115,0.15)',
            color: holderMomentum.is_declining ? '#ff4757' : '#2ed573',
            fontWeight: 600,
          }}>
            {holderMomentum.is_declining ? '📉 Declining' : '📈 Growing'}
          </div>
        </div>
      </div>

      {/* Flags */}
      {flags.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {flags.map((flag, i) => {
            const badge = getFlagBadge(flag.type);
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: badge.bg,
                  border: `1px solid ${badge.color}33`,
                  fontSize: 'var(--text-xs)',
                  color: badge.color,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {badge.emoji} <strong>{flag.type}</strong> — {flag.description}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Timeline Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        {/* Tweet Timeline */}
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <h4 style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
            Tweet Count Timeline
          </h4>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={tweetData}>
              <defs>
                <linearGradient id="tweetGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c5cfc" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#7c5cfc" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: 'rgba(10,10,30,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
              />
              <Area type="monotone" dataKey="tweets" stroke="#7c5cfc" fill="url(#tweetGrad)" strokeWidth={2} />
              <Line type="monotone" dataKey="users" stroke="#2ed573" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Holder Timeline */}
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <h4 style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
            Holder Count Timeline
          </h4>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={holderData}>
              <defs>
                <linearGradient id="holderGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00e99e" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#00e99e" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: 'rgba(10,10,30,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
              />
              <Area type="monotone" dataKey="holders" stroke="#00e99e" fill="url(#holderGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default VelocityGauge;
