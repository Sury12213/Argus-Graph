import { motion } from 'framer-motion';

interface SocialPanelProps {
  data: {
    social_score: number;
    tweet_count?: number;
    unique_authors?: number;
    bot_ratio: number;
    sentiment?: number;
    sentiment_label?: string;
    telegram_members?: number;
    telegram_active?: number;
    mentions_growth_rate?: number;
    // Legacy mock fields
    unique_users?: number;
    activity_level?: string;
    trending_rank?: number | null;
  } | null;
}

const SocialPanel = ({ data }: SocialPanelProps) => {
  if (!data) return null;

  // Normalize sentiment — API returns number + label, mock returns string
  const sentimentLabel = data.sentiment_label ?? 
    (typeof data.sentiment === 'number' 
      ? (data.sentiment > 0.3 ? 'POSITIVE' : data.sentiment < -0.3 ? 'NEGATIVE' : 'NEUTRAL')
      : String(data.sentiment ?? 'neutral'));

  const normalizedSentiment = sentimentLabel.toLowerCase();
  const uniqueUsers = data.unique_authors ?? data.unique_users ?? 0;
  const tweetCount = data.tweet_count ?? 0;
  
  // Determine activity level from mentions growth rate
  const growthRate = data.mentions_growth_rate ?? 0;
  const activityLevel = data.activity_level ?? 
    (growthRate > 200 ? 'viral' : growthRate > 50 ? 'high' : growthRate > 10 ? 'moderate' : 'low');

  const sentimentConfig: Record<string, { color: string; emoji: string; bg: string }> = {
    positive: { color: '#2ed573', emoji: '😄', bg: 'rgba(46,213,115,0.12)' },
    neutral: { color: '#eccc68', emoji: '😐', bg: 'rgba(236,204,104,0.12)' },
    negative: { color: '#ff4757', emoji: '😰', bg: 'rgba(255,71,87,0.12)' },
    suspicious: { color: '#ffa502', emoji: '🤔', bg: 'rgba(255,165,2,0.12)' },
    mixed: { color: '#ffa502', emoji: '🤔', bg: 'rgba(255,165,2,0.12)' },
  };

  const activityConfig: Record<string, { color: string; label: string }> = {
    viral: { color: '#ff4757', label: '🔥 VIRAL' },
    high: { color: '#ffa502', label: '📈 HIGH' },
    moderate: { color: '#eccc68', label: '➡️ MODERATE' },
    low: { color: '#70a1ff', label: '📉 LOW' },
  };

  const sent = sentimentConfig[normalizedSentiment] ?? sentimentConfig.neutral;
  const activity = activityConfig[activityLevel] ?? activityConfig.moderate;

  return (
    <div className="card" style={{ padding: 'var(--space-4)' }}>
      <h3 style={{
        fontSize: 'var(--text-sm)', fontWeight: 700,
        marginBottom: 'var(--space-4)',
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      }}>
        📡 Social Intelligence
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        {/* Sentiment */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            textAlign: 'center', padding: 'var(--space-3)',
            background: sent.bg, borderRadius: 'var(--radius-md)',
            border: `1px solid ${sent.color}22`,
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 4 }}>{sent.emoji}</div>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: sent.color, textTransform: 'uppercase' }}>
            {sentimentLabel}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--color-text-muted)', marginTop: 2 }}>Sentiment</div>
        </motion.div>

        {/* Activity Level */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{
            textAlign: 'center', padding: 'var(--space-3)',
            background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 800, color: activity.color, marginBottom: 4 }}>
            {activity.label}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Activity</div>
        </motion.div>

        {/* Bot Ratio */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{
            textAlign: 'center', padding: 'var(--space-3)',
            background: data.bot_ratio > 0.4 ? 'rgba(255,71,87,0.1)' : 'rgba(255,255,255,0.03)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${data.bot_ratio > 0.4 ? 'rgba(255,71,87,0.2)' : 'var(--color-border)'}`,
          }}
        >
          <div style={{
            fontSize: 'var(--text-lg)', fontWeight: 900, fontFamily: 'var(--font-mono)',
            color: data.bot_ratio > 0.4 ? '#ff4757' : data.bot_ratio > 0.2 ? '#eccc68' : '#2ed573',
          }}>
            {(data.bot_ratio * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Bot Ratio</div>
        </motion.div>
      </div>

      {/* Stats Row */}
      <div style={{
        display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)',
        paddingTop: 'var(--space-3)', flexWrap: 'wrap',
      }}>
        <span>📝 {tweetCount.toLocaleString()} tweets</span>
        <span>👤 {uniqueUsers.toLocaleString()} unique users</span>
        {data.telegram_members && <span>💬 {data.telegram_members.toLocaleString()} TG members</span>}
        {data.trending_rank && <span>🏆 Trending #{data.trending_rank}</span>}
      </div>
    </div>
  );
};

export default SocialPanel;
