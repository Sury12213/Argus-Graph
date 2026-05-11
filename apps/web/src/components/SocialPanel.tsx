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
    // Legacy API fields
    unique_users?: number;
    activity_level?: string;
    trending_rank?: number | null;
    data_source?: 'twitter_live' | 'unavailable' | string;
  } | null;
}

const SocialPanel = ({ data }: SocialPanelProps) => {
  if (!data) return null;

  // Normalize sentiment - API can return number + label or legacy string shape
  const sentimentLabel = data.sentiment_label ?? 
    (typeof data.sentiment === 'number' 
      ? (data.sentiment > 0.3 ? 'POSITIVE' : data.sentiment < -0.3 ? 'NEGATIVE' : 'NEUTRAL')
      : String(data.sentiment ?? 'neutral'));

  const normalizedSentiment = sentimentLabel.toLowerCase();
  const uniqueUsers = data.unique_authors ?? data.unique_users ?? null;
  const tweetCount = data.tweet_count ?? null;
  
  // Determine activity level from mentions growth rate
  const growthRate = data.mentions_growth_rate ?? 0;
  const activityLevel = data.activity_level ?? 
    (growthRate > 200 ? 'viral' : growthRate > 50 ? 'high' : growthRate > 10 ? 'moderate' : 'low');

  const sentimentConfig: Record<string, { color: string; emoji: string; bg: string }> = {
    positive: { color: '#37c978', emoji: 'POS', bg: 'rgba(55,201,120,0.12)' },
    neutral: { color: '#f5b849', emoji: 'NEU', bg: 'rgba(245,184,73,0.12)' },
    negative: { color: '#ff5f6d', emoji: 'NEG', bg: 'rgba(255,95,109,0.12)' },
    suspicious: { color: '#f5b849', emoji: 'SUSP', bg: 'rgba(245,184,73,0.12)' },
    mixed: { color: '#f5b849', emoji: 'MIX', bg: 'rgba(245,184,73,0.12)' },
  };

  const activityConfig: Record<string, { color: string; label: string }> = {
    viral: { color: '#ff5f6d', label: 'VIRAL' },
    high: { color: '#f5b849', label: 'HIGH' },
    moderate: { color: '#f5b849', label: 'MODERATE' },
    low: { color: '#7fb0ff', label: 'LOW' },
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
         Social Intelligence
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
        <span> {tweetCount != null ? tweetCount.toLocaleString() + ' tweets' : ' Loading...'}</span>
        <span> {uniqueUsers != null ? uniqueUsers.toLocaleString() + ' unique users' : '-'}</span>
        {data.telegram_members != null && <span> {data.telegram_members.toLocaleString()} TG members</span>}
        {data.trending_rank && <span> Trending #{data.trending_rank}</span>}
        {data.data_source === 'twitter_live' && (
          <span style={{ marginLeft: 'auto', fontSize: 9, color: '#1da1f2', fontWeight: 700 }}> LIVE</span>
        )}
        {data.data_source === 'unavailable' && (
          <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--color-text-muted)' }}>No social data</span>
        )}
      </div>
    </div>
  );
};

export default SocialPanel;


