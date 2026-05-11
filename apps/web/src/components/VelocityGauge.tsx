import { motion } from 'framer-motion';
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
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
  // Real Twitter metrics are null when RapidAPI is not configured.
  tweet_growth_rate?: number | null;
  tweet_unique_users?: number | null;
  tweet_bot_ratio?: number | null;
  tweet_is_bot_pump?: boolean;
  // DexScreener
  tx_count_h1?: number;
  price_change_h1?: number;
  has_paid_boost?: boolean;
  // Source flags show which backend enrichment providers contributed to the scan.
  sources?: { dexscreener?: boolean; pumpfun?: boolean; twitter?: boolean; telegram?: boolean; helius_blocks?: boolean; ai_sentiment?: boolean };
  // Instant chart data comes from current scan timelines instead of historical snapshots.
  tweet_timeline?: { time: string; count: number }[];
  dex_buy_timeline?: { time: string; buys: number; sells: number }[];
  // Pillar 3: Sentiment Shift
  sentiment_shift?: number;
  sentiment_label?: string;
  is_sentiment_crash?: boolean;
  // KOL fields explain whether influential accounts are driving the social spike.
  kol_count?: number;
  kol_names?: string[];
  is_organized_shill?: boolean;
  weighted_shill_reach?: number;
  shill_size?: 'NONE' | 'MICRO' | 'MID' | 'MEGA';
  // Engagement decay fields compare recent interactions against older tweets in the same scan.
  total_engagement?: number;
  avg_engagement_per_tweet?: number;
  engagement_decay_pct?: number;
  is_engagement_dying?: boolean;
  // Liquidity fields show whether shallow pools can amplify price impact.
  liquidity_ratio?: number;
  is_flash_crash_risk?: boolean;
  liquidity_usd?: number;
  // V_pressure compares estimated buy volume against sell volume.
  v_pressure?: number;
  buy_volume_h1?: number;
  sell_volume_h1?: number;
  // Telegram fields show whether community membership is growing or shrinking.
  tg_group?: string | null;
  tg_member_count?: number | null;
  tg_member_growth_rate?: number | null;
  tg_member_delta?: number | null;
  is_tg_surging?: boolean;
  is_tg_declining?: boolean;
  // Block-density fields expose bursty same-slot trading and consecutive buy-heavy blocks.
  block_density_pct?: number | null;
  consecutive_buy_blocks?: number | null;
  is_god_candle?: boolean;
  // AI sentiment fields summarize sarcasm, fear, and narrative context from top tweets.
  ai_sentiment?: string | null;
  ai_confidence?: number | null;
  ai_summary?: string | null;
  ai_sarcasm_detected?: boolean;
  ai_key_concerns?: string[];
}

const FLAG_BADGE: Record<string, { color: string; emoji: string; bg: string }> = {
  BOT_PUMP:        { color: '#ff5f6d', emoji: 'BOT', bg: 'rgba(255,95,109,0.12)' },
  DUMP_RISK:       { color: '#f5b849', emoji: 'DOWN', bg: 'rgba(245,184,73,0.12)' },
  DEGEN_PLAY:      { color: '#7fb0ff', emoji: 'RISK', bg: 'rgba(127,176,255,0.12)' },
  PAID_PROMO:      { color: '#f5b849', emoji: 'AD', bg: 'rgba(245,184,73,0.12)' },
  HEALTHY:         { color: '#37c978', emoji: 'OK', bg: 'rgba(55,201,120,0.12)' },
  SENTIMENT_SHIFT: { color: '#ff5f6d', emoji: 'SENT', bg: 'rgba(255,95,109,0.12)' },
  HOLDER_LAG:      { color: '#f5b849', emoji: 'LAG', bg: 'rgba(245,184,73,0.12)' },
  KOL_SHILL:       { color: '#7fb0ff', emoji: 'KOL', bg: 'rgba(127,176,255,0.12)' },
  ENGAGEMENT_DECAY:{ color: '#9aa7b8', emoji: 'DECAY', bg: 'rgba(154,167,184,0.12)' },
  FLASH_CRASH:     { color: '#ff5f6d', emoji: 'FLASH', bg: 'rgba(255,95,109,0.12)' },
  TG_SURGE:        { color: '#38bdf8', emoji: 'TG+', bg: 'rgba(56,189,248,0.12)' },
  TG_DECLINE:      { color: '#ff5f6d', emoji: 'TG-', bg: 'rgba(255,95,109,0.12)' },
  GOD_CANDLE:      { color: '#f5b849', emoji: 'BLOCK', bg: 'rgba(245,184,73,0.12)' },
  AI_BEARISH:      { color: '#ff5f6d', emoji: 'AI', bg: 'rgba(255,95,109,0.12)' },
};

const VelocityGauge = ({
  tweetVelocity, holderMomentum, flags, snapshots,
  tweet_growth_rate, tweet_unique_users, tweet_bot_ratio, tweet_is_bot_pump,
  tx_count_h1, price_change_h1, has_paid_boost,
  sources,
  tweet_timeline = [],
  dex_buy_timeline = [],
  sentiment_shift = 0,
  sentiment_label = 'STABLE',
  is_sentiment_crash = false,
  // Defaults for optional risk signals keep the gauge stable when enrichment data is missing.
  kol_count = 0, kol_names = [],
  weighted_shill_reach = 0, shill_size = 'NONE' as 'NONE' | 'MICRO' | 'MID' | 'MEGA',
  avg_engagement_per_tweet = 0, engagement_decay_pct = 0, is_engagement_dying = false,
  liquidity_ratio = 0, is_flash_crash_risk = false,
  v_pressure = 1,
  // Defaults for optional enrichment signals mirror backend null-safe response fields.
  tg_group = null, tg_member_count = null, tg_member_growth_rate = null, tg_member_delta = null,
  is_tg_surging = false, is_tg_declining = false,
  block_density_pct = null, consecutive_buy_blocks = null, is_god_candle = false,
  ai_sentiment = null, ai_confidence = null, ai_summary = null,
  ai_sarcasm_detected = false, ai_key_concerns = [],
}: VelocityGaugeProps) => {
  // Prefer RapidAPI tweet metrics when available; DexScreener proxy keeps the UI populated without Twitter access.
  const hasRealTweets = tweet_growth_rate != null;
  const growthRate  = hasRealTweets ? (tweet_growth_rate ?? 0) : tweetVelocity.growth_rate;
  const botRatio    = hasRealTweets ? (tweet_bot_ratio ?? 1)  : tweetVelocity.bot_ratio;
  const isBotPump   = tweet_is_bot_pump ?? botRatio > 5;

  // Current scan timelines are more precise; legacy snapshots remain as fallback for older API responses.
  const tweetChartData = tweet_timeline.length > 0
    ? tweet_timeline.map(t => ({ time: t.time, tweets: t.count }))
    : snapshots.tweets.map((s, i) => ({
        time: `T-${(snapshots.tweets.length - 1 - i) * 5}m`,
        tweets: s.count,
        users: s.unique_users,
      }));

  // Holder proxy chart from DexScreener buy/sell timeline
  const holderChartData = dex_buy_timeline.length > 0
    ? dex_buy_timeline
    : snapshots.holders.map((s, i) => ({
        time: `T-${(snapshots.holders.length - 1 - i) * 5}m`,
        buys: s.count,
        sells: 0,
      }));

  const forceBearishAi = (price_change_h1 ?? 0) <= -50 || is_flash_crash_risk || v_pressure < 0.5 || is_god_candle;
  const displayedAiSentiment = forceBearishAi ? 'BEARISH' : ai_sentiment;
  const displayedAiConfidence = forceBearishAi ? Math.max(ai_confidence ?? 0, (price_change_h1 ?? 0) <= -90 ? 95 : 88) : ai_confidence;
  const displayedAiSummary = forceBearishAi
    ? ((price_change_h1 ?? 0) <= -50
      ? `Token dropped ${Math.abs(price_change_h1 ?? 0).toFixed(0)}% in 1h; social activity is crash context.`
      : 'Market structure shows exit-liquidity risk; bullish sentiment is suppressed.')
    : ai_summary;
  const displayedAiConcerns = forceBearishAi
    ? Array.from(new Set([...(ai_key_concerns ?? []), 'Severe price crash', 'Exit-liquidity risk'])).slice(0, 5)
    : ai_key_concerns;
  const showTelegramVelocity = sources?.telegram || tg_group || tg_member_count != null;
  const showBlockDensity = sources?.helius_blocks || block_density_pct != null || consecutive_buy_blocks != null;
  const showAiSentiment = sources?.ai_sentiment || displayedAiSentiment || displayedAiSummary;
  const finalPieces = [
    showTelegramVelocity ? 'telegram' : null,
    showBlockDensity ? 'blocks' : null,
    showAiSentiment ? 'ai' : null,
  ].filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

      {/*  Source badges  */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {sources?.twitter && (
          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'rgba(29,161,242,0.15)', border: '1px solid rgba(29,161,242,0.3)', color: '#1da1f2', fontWeight: 700, letterSpacing: '0.06em' }}>
             LIVE
          </span>
        )}
        {sources?.dexscreener && (
          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'rgba(124,92,252,0.12)', border: '1px solid rgba(124,92,252,0.3)', color: '#a78bfa', fontWeight: 700 }}>
            DEX
          </span>
        )}
        {sources?.pumpfun && (
          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'rgba(255,165,2,0.12)', border: '1px solid rgba(255,165,2,0.3)', color: '#ffa502', fontWeight: 700 }}>
            PUMP.FUN
          </span>
        )}
        {!sources?.twitter && (
          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--color-text-muted)' }}>
             OFFLINE - using tx proxy
          </span>
        )}
        {sources?.telegram && (
          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'rgba(0,210,211,0.12)', border: '1px solid rgba(0,210,211,0.3)', color: '#00d2d3', fontWeight: 700 }}>
             TG
          </span>
        )}
        {sources?.helius_blocks && (
          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'rgba(255,159,67,0.12)', border: '1px solid rgba(255,159,67,0.3)', color: '#ff9f43', fontWeight: 700 }}>
             BLOCKS
          </span>
        )}
        {sources?.ai_sentiment && (
          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'rgba(196,69,105,0.12)', border: '1px solid rgba(196,69,105,0.3)', color: '#c44569', fontWeight: 700 }}>
             AI
          </span>
        )}
      </div>

      {/*  Main row: Gauge + Real Stats  */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>

        {/* Tweet Velocity Gauge */}
        <div className="card" style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
          <h4 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
            {sources?.twitter ? ' Tweet Velocity' : ' Tx Velocity Proxy'}
          </h4>

          {/* Live stats row (only with real Twitter data) */}
          {hasRealTweets && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
              <div style={{ padding: '6px', background: 'rgba(29,161,242,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(29,161,242,0.15)' }}>
                <div style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#1da1f2' }}>
                  {tweet_unique_users ?? 0}
                </div>
                <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>UNIQUE USERS</div>
              </div>
              <div style={{ padding: '6px', background: isBotPump ? 'rgba(255,71,87,0.06)' : 'rgba(46,213,115,0.06)', borderRadius: 'var(--radius-sm)', border: `1px solid ${isBotPump ? 'rgba(255,71,87,0.2)' : 'rgba(46,213,115,0.15)'}` }}>
                <div style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: isBotPump ? '#ff4757' : '#2ed573' }}>
                  {botRatio.toFixed(1)}x
                </div>
                <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>BOT RATIO</div>
              </div>
            </div>
          )}

          {/* SVG Gauge - range: 0% (left)  200%+ (right) */}
          {(() => {
            // Bug fix: !tweet_growth_rate is true when growth_rate===0 (valid 2nd scan with no change).
            // Must use == null to distinguish "no Twitter data" from "data exists but 0% change".
            const isFirstScan = tweet_growth_rate == null;
            // Normalize growthRate 0..200  0..1 gauge fill (clamp negatives to 0)
            const normalizedFill = Math.min(1, Math.max(0, growthRate / 200));
            // Needle angle: -90deg = far left (0%), +90deg = far right (200%+)
            const needleDeg = normalizedFill * 180 - 90;
            const arcColor = isBotPump ? '#ff4757'
              : growthRate >= 150 ? '#ff4757'
              : growthRate >= 80  ? '#ffa502'
              : growthRate >= 30  ? '#eccc68'
              : '#2ed573';
            return (
              <svg viewBox="0 0 200 120" style={{ width: '100%', maxWidth: 200, margin: '0 auto', display: 'block' }}>
                <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="12" strokeLinecap="round" />
                <motion.path
                  d="M 20 100 A 80 80 0 0 1 180 100"
                  fill="none"
                  stroke={isFirstScan ? 'rgba(255,255,255,0.12)' : arcColor}
                  strokeWidth="12"
                  strokeLinecap="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: isFirstScan ? 0 : normalizedFill }}
                  transition={{ duration: 1.2, ease: 'easeOut' }}
                  style={{ filter: isFirstScan ? 'none' : `drop-shadow(0 0 6px ${arcColor})` }}
                />
                {/* Needle - use CSS rotate via style, not animate (SVG framer-motion bug) */}
                <motion.g
                  style={{ transformOrigin: '100px 100px' }}
                  initial={{ rotate: -90 }}
                  animate={{ rotate: needleDeg }}
                  transition={{ duration: 1.1, ease: 'easeOut' }}
                >
                  <line x1="100" y1="100" x2="100" y2="28" stroke={isFirstScan ? 'rgba(255,255,255,0.25)' : 'white'} strokeWidth="2.5" strokeLinecap="round" />
                </motion.g>
                <circle cx="100" cy="100" r="5" fill="white" />
                <text x="100" y="90" textAnchor="middle" fill={isFirstScan ? 'rgba(255,255,255,0.3)' : 'white'} fontSize="17" fontWeight="bold" fontFamily="var(--font-mono)">
                  {isFirstScan ? '-' : `${growthRate > 0 ? '+' : ''}${growthRate.toFixed(0)}%`}
                </text>
                <text x="100" y="108" textAnchor="middle" fill="rgba(255,255,255,0.38)" fontSize="7.5">
                  {isFirstScan ? 'AWAITING 2ND SCAN' : 'GROWTH RATE'}
                </text>
                <text x="20" y="116" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="6.5">0%</text>
                <text x="180" y="116" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="6.5">200%+</text>
              </svg>
            );
          })()}


          {!hasRealTweets && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Bot Ratio: <span style={{ color: botRatio > 5 ? '#ff4757' : '#2ed573', fontWeight: 700 }}>{botRatio.toFixed(1)}x</span>
            </div>
          )}
        </div>

        {/* Right side: DexScreener stats + Holder Momentum */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* DexScreener quick stats */}
          {tx_count_h1 != null && (
            <div className="card" style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 6, letterSpacing: '0.06em' }}>DEXSCREENER 1H</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#a78bfa' }}>{tx_count_h1}</div>
                  <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>TRANSACTIONS</div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)', color: (price_change_h1 ?? 0) >= 0 ? '#2ed573' : '#ff4757' }}>
                    {(price_change_h1 ?? 0) >= 0 ? '+' : ''}{(price_change_h1 ?? 0).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>PRICE 1H</div>
                </div>
              </div>
              {has_paid_boost && (
                <div style={{ marginTop: 6, fontSize: 9, color: '#eccc68', background: 'rgba(236,204,104,0.08)', padding: '2px 8px', borderRadius: 4 }}>
                   Paid Boost Active
                </div>
              )}
            </div>
          )}

          {/* Holder Momentum - Pillar 2 */}
          <div className="card" style={{ padding: '10px 12px', textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 6, letterSpacing: '0.06em' }}>HOLDER MOMENTUM</div>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.6 }}
              style={{
                fontSize: 'var(--text-2xl)', fontWeight: 900, fontFamily: 'var(--font-mono)',
                color: holderMomentum.is_declining ? '#ff4757' : holderMomentum.growth_rate > 5 ? '#2ed573' : '#eccc68',
                marginBottom: 6,
              }}
            >
              {holderMomentum.growth_rate >= 0 ? '+' : ''}{holderMomentum.growth_rate.toFixed(1)}%
            </motion.div>
            <div style={{
              fontSize: 9, padding: '3px 10px', borderRadius: 'var(--radius-full)', display: 'inline-block',
              background: holderMomentum.is_declining ? 'rgba(255,71,87,0.12)' : 'rgba(46,213,115,0.12)',
              color: holderMomentum.is_declining ? '#ff4757' : '#2ed573', fontWeight: 700,
            }}>
              {holderMomentum.is_declining ? ' Declining' : ' Growing'}
            </div>
          </div>

          {/* Sentiment Shift - Pillar 3 */}
          <div className="card" style={{ padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 6, letterSpacing: '0.06em' }}>SENTIMENT SHIFT</div>
            <div style={{
              fontSize: 'var(--text-lg)', fontWeight: 900, fontFamily: 'var(--font-mono)',
              color: is_sentiment_crash ? '#ff4757' : sentiment_label === 'DECLINING' ? '#ffa502' : sentiment_label === 'IMPROVING' ? '#2ed573' : 'var(--color-text-secondary)',
            }}>
              {sentiment_label === 'STABLE' && '-'}
              {sentiment_label === 'IMPROVING' && ` +${sentiment_shift}pt`}
              {sentiment_label === 'DECLINING' && ` ${sentiment_shift}pt`}
              {sentiment_label === 'CRASH' && ` ${sentiment_shift}pt`}
            </div>
            <div style={{
              fontSize: 9, padding: '3px 10px', marginTop: 4, borderRadius: 'var(--radius-full)', display: 'inline-block',
              background: is_sentiment_crash ? 'rgba(255,71,87,0.12)' : sentiment_label === 'DECLINING' ? 'rgba(255,165,2,0.12)' : 'rgba(46,213,115,0.06)',
              color: is_sentiment_crash ? '#ff4757' : sentiment_label === 'DECLINING' ? '#ffa502' : '#70a1ff',
              fontWeight: 700,
            }}>
              {sentiment_label === 'CRASH' ? ' Fear Crash' : sentiment_label === 'DECLINING' ? ' Declining' : sentiment_label === 'IMPROVING' ? ' Improving' : ' Stable'}
            </div>
          </div>
        </div>
      </div>

      {/*  Quick Win Metrics Row  */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)' }}>
        {/* KOL Detection - follower-weighted */}
        <div className="card" style={{ padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 8, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>KOL PRESENCE</div>
          <div style={{
            fontSize: 'var(--text-lg)', fontWeight: 900, fontFamily: 'var(--font-mono)',
            color: shill_size === 'MEGA' ? '#f53b57' : shill_size === 'MID' ? '#e056fd' : kol_count > 0 ? '#a78bfa' : 'var(--color-text-secondary)',
          }}>
            {kol_count}
          </div>
          {/* Shill Size Badge */}
          <div style={{
            fontSize: 8, fontWeight: 700, marginTop: 2,
            color: shill_size === 'MEGA' ? '#f53b57' : shill_size === 'MID' ? '#e056fd' : shill_size === 'MICRO' ? '#a78bfa' : 'var(--color-text-muted)',
          }}>
            {shill_size === 'MEGA' ? ' MEGA SHILL' : shill_size === 'MID' ? ' MID SHILL' : shill_size === 'MICRO' ? ' MICRO' : 'no KOLs'}
          </div>
          {/* Combined reach */}
          {weighted_shill_reach > 0 && (
            <div style={{ fontSize: 7, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {weighted_shill_reach >= 1_000_000
                ? `${(weighted_shill_reach / 1_000_000).toFixed(1)}M reach`
                : `${(weighted_shill_reach / 1000).toFixed(0)}K reach`}
            </div>
          )}
          {kol_names.length > 0 && (
            <div style={{ fontSize: 7, color: '#a78bfa', marginTop: 2, lineHeight: 1.3 }}>
              {kol_names.slice(0, 2).join(', ')}
            </div>
          )}
        </div>

        {/* Engagement Health */}
        <div className="card" style={{ padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 8, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>ENGAGEMENT</div>
          <div style={{
            fontSize: 'var(--text-lg)', fontWeight: 900, fontFamily: 'var(--font-mono)',
            color: is_engagement_dying ? '#ff4757' : engagement_decay_pct > 20 ? '#2ed573' : '#eccc68',
          }}>
            {avg_engagement_per_tweet}
          </div>
          <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>avg/tweet</div>
          <div style={{
            fontSize: 8, marginTop: 3, fontWeight: 700,
            color: is_engagement_dying ? '#ff4757' : engagement_decay_pct > 0 ? '#2ed573' : '#ffa502',
          }}>
            {is_engagement_dying ? ' Dying' : engagement_decay_pct > 0 ? ` +${engagement_decay_pct.toFixed(0)}%` : ` ${engagement_decay_pct.toFixed(0)}%`}
          </div>
        </div>

        {/* V_pressure */}
        <div className="card" style={{ padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 8, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>V_PRESSURE</div>
          <div style={{
            fontSize: 'var(--text-lg)', fontWeight: 900, fontFamily: 'var(--font-mono)',
            color: v_pressure > 1.5 ? '#2ed573' : v_pressure < 0.5 ? '#ff4757' : '#eccc68',
          }}>
            {v_pressure.toFixed(2)}x
          </div>
          <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>buy/sell</div>
          <div style={{
            fontSize: 8, marginTop: 3, fontWeight: 700,
            color: v_pressure > 1.5 ? '#2ed573' : v_pressure < 0.5 ? '#ff4757' : '#ffa502',
          }}>
            {v_pressure > 1.5 ? 'BUY PRESSURE' : v_pressure < 0.5 ? 'SELL PRESSURE RISK' : 'BALANCED FLOW'}
          </div>
        </div>

        {/* Liquidity Depth */}
        <div className="card" style={{ padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 8, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>LIQUIDITY</div>
          <div style={{
            fontSize: 'var(--text-lg)', fontWeight: 900, fontFamily: 'var(--font-mono)',
            color: is_flash_crash_risk ? '#ff4757' : liquidity_ratio > 3 ? '#ffa502' : '#2ed573',
          }}>
            {liquidity_ratio.toFixed(1)}x
          </div>
          <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>vol/liq</div>
          <div style={{
            fontSize: 8, marginTop: 3, fontWeight: 700,
            color: is_flash_crash_risk ? '#ff4757' : liquidity_ratio > 3 ? '#ffa502' : '#70a1ff',
          }}>
            {is_flash_crash_risk ? 'FLASH CRASH RISK' : liquidity_ratio > 3 ? 'THIN LIQUIDITY' : 'NORMAL DEPTH'}
          </div>
        </div>
      </div>

      {finalPieces.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${finalPieces.length}, 1fr)`, gap: 'var(--space-2)' }}>
          {showTelegramVelocity && (
            <div className="card" style={{ padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 8, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}> TELEGRAM</div>
              <div style={{
                fontSize: 'var(--text-lg)', fontWeight: 900, fontFamily: 'var(--font-mono)',
                color: is_tg_surging ? '#00d2d3' : is_tg_declining ? '#ff6348' : 'var(--color-text-secondary)',
              }}>
                {tg_member_count?.toLocaleString() ?? 'Unknown'}
              </div>
              <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>{tg_group ?? 'Telegram linked'}</div>
              {tg_member_growth_rate != null && tg_member_growth_rate !== 0 && (
                <div style={{
                  fontSize: 8, marginTop: 2, fontWeight: 700,
                  color: tg_member_growth_rate > 0 ? '#00d2d3' : '#ff6348',
                }}>
                  {tg_member_growth_rate > 0 ? '' : ''} {Math.abs(tg_member_growth_rate)}% ({tg_member_delta! > 0 ? '+' : ''}{tg_member_delta})
                </div>
              )}
              {is_tg_surging && <div style={{ fontSize: 7, color: '#00d2d3', marginTop: 2 }}> MEMBER SURGE</div>}
              {is_tg_declining && <div style={{ fontSize: 7, color: '#ff6348', marginTop: 2 }}> EXODUS</div>}
            </div>
          )}

          {showBlockDensity && (
            <div className="card" style={{ padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 8, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}> BLOCK DENSITY</div>
              <div style={{
                fontSize: 'var(--text-lg)', fontWeight: 900, fontFamily: 'var(--font-mono)',
                color: is_god_candle ? '#ff9f43' : (block_density_pct ?? 0) >= 60 ? '#ffa502' : 'var(--color-text-secondary)',
              }}>
                {block_density_pct != null ? `${block_density_pct}%` : 'Unknown'}
              </div>
              <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>blocks with swaps</div>
              {consecutive_buy_blocks != null && consecutive_buy_blocks > 0 && (
                <div style={{
                  fontSize: 8, marginTop: 2, fontWeight: 700,
                  color: is_god_candle ? '#ff9f43' : '#eccc68',
                }}>
                  {is_god_candle ? 'UNSTABLE PUMP RISK' : `${consecutive_buy_blocks} buy streak`}
                </div>
              )}
            </div>
          )}

          {showAiSentiment && (
            <div className="card" style={{ padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 8, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}> AI SENTIMENT</div>
              <div style={{
                fontSize: 'var(--text-md)', fontWeight: 900, fontFamily: 'var(--font-mono)',
                color: displayedAiSentiment === 'BULLISH' ? '#2ed573'
                  : displayedAiSentiment === 'BEARISH' ? '#ff4757'
                  : displayedAiSentiment === 'MIXED' ? '#ffa502'
                  : 'var(--color-text-secondary)',
              }}>
                {displayedAiSentiment ?? 'Unknown'}
              </div>
              {displayedAiConfidence != null && (
                <div style={{ fontSize: 8, color: 'var(--color-text-muted)' }}>{displayedAiConfidence}% confident</div>
              )}
              {displayedAiSummary && (
                <div style={{ fontSize: 7, color: '#a78bfa', marginTop: 3, lineHeight: 1.3, fontStyle: 'italic' }}>
                  "{displayedAiSummary}"
                </div>
              )}
              {ai_sarcasm_detected && (
                <div style={{ fontSize: 7, color: '#c44569', marginTop: 2 }}> Sarcasm detected!</div>
              )}
              {displayedAiConcerns.length > 0 && (
                <div style={{ fontSize: 7, color: '#ff6b81', marginTop: 2 }}>
                   {displayedAiConcerns.slice(0, 2).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/*  Flags  */}
      {flags.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {flags.map((flag, i) => {
            const badge = FLAG_BADGE[flag.type] ?? { color: '#70a1ff', emoji: '', bg: 'rgba(112,161,255,0.12)' };
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                style={{
                  padding: '5px 12px', borderRadius: 'var(--radius-md)',
                  background: badge.bg, border: `1px solid ${badge.color}33`,
                  fontSize: 10, color: badge.color,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {badge.emoji} <strong>{flag.type}</strong> - {flag.description}
              </motion.div>
            );
          })}
        </div>
      )}

      {/*  Timeline Charts  */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        {/* Tweet Timeline - instant from created_at parsing */}
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <h4 style={{ fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 8, letterSpacing: '0.06em' }}>
            TWEET ACTIVITY (LAST 6H)
            {sources?.twitter && <span style={{ color: '#1da1f2', marginLeft: 6 }}> LIVE</span>}
          </h4>
          {tweetChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={100}>
              <AreaChart data={tweetChartData}>
                <defs>
                  <linearGradient id="tweetGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7c5cfc" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#7c5cfc" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={{ background: 'rgba(10,10,30,0.9)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 10 }} />
                <Area type="monotone" dataKey="tweets" stroke="#7c5cfc" fill="url(#tweetGrad)" strokeWidth={2} name="Tweets" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 10 }}>
              {sources?.twitter ? 'Tweets are too old or unavailable' : 'RAPIDAPI_KEY is required to show the tweet timeline'}
            </div>
          )}
        </div>

        {/* Holder Proxy: DexScreener Buy/Sell chart - available instantly */}
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <h4 style={{ fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 8, letterSpacing: '0.06em' }}>
            BUY/SELL FLOW (HOLDER PROXY)
            <span style={{ color: '#a78bfa', marginLeft: 6 }}>DEX</span>
          </h4>
          {holderChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={100}>
              <AreaChart data={holderChartData}>
                <defs>
                  <linearGradient id="buyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2ed573" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2ed573" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id="sellGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff4757" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#ff4757" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={{ background: 'rgba(10,10,30,0.9)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 10 }} />
                <Area type="monotone" dataKey="buys" stroke="#2ed573" fill="url(#buyGrad)" strokeWidth={2} name="Buys" />
                <Area type="monotone" dataKey="sells" stroke="#ff4757" fill="url(#sellGrad)" strokeWidth={1.5} name="Sells" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 10 }}>
              No DexScreener data available
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VelocityGauge;
