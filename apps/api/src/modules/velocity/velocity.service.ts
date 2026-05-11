import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import type { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { HeliusService } from '../../providers/helius/helius.service';
import type { BlockDensityData } from '../../providers/helius/helius.service';
import { RedisService } from '../../providers/redis/redis.service';
import { SocialScraperService } from './social-scraper.service';
import { TelegramVelocityService } from './telegram-velocity.service';
import type { TelegramVelocityData } from './telegram-velocity.service';
import { AISentimentService } from './ai-sentiment.service';
import type { AISentimentResult } from './ai-sentiment.service';

/**
 * Velocity Engine v2 — Multi-Source Social Intelligence
 *
 * Uses low-cost public data sources instead of the paid Twitter API:
 *
 * 1. DexScreener   — Tx velocity h1/h6, price momentum, paid boosts
 *    → API: api.dexscreener.com  (no key needed)
 *    → Insight: Tx surge = social FOMO proxy. "Boosts" = team spent money promoting
 *
 * 2. Pump.fun      — reply_count, holder growth, king_of_hill status
 *    → API: frontend-api.pump.fun  (no key needed, Solana-native)
 *    → Insight: Most Solana memes start here. Reply velocity = raw community excitement
 *
 * 3. LunarCrush    — galaxy_score, social_volume (free public tier)
 *    → API: lunarcrush.com/api4/public  (no key for basic data)
 *    → Insight: Aggregates Reddit/YouTube/news — broader sentiment picture
 *
 * Output: velocity_score 0-100 (higher = riskier)
 *         hype_detected: boolean (for DEGEN_PLAY signal)
 */
@Injectable()
export class VelocityService {
  private readonly logger = new Logger(VelocityService.name);

  constructor(
    private helius: HeliusService,
    private redis: RedisService,
    private http: HttpService,
    private social: SocialScraperService,
    private telegramVelocity: TelegramVelocityService,
    private aiSentiment: AISentimentService,
  ) {}

  async analyze(tokenAddress: string): Promise<VelocityAnalysisResult> {
    this.logger.debug(`[Velocity] Analyzing ${tokenAddress}`);

    // Fetch all sources in parallel — total time = slowest source
    const [dexData, pumpData, geckoData, heliusData] = await Promise.allSettled([
      this.fetchDexScreener(tokenAddress),
      this.fetchPumpFun(tokenAddress),
      this.fetchCoinGecko(tokenAddress),
      this.helius.getVelocityData(tokenAddress),
    ]);

    const dex = dexData.status === 'fulfilled' ? dexData.value : null;
    const pump = pumpData.status === 'fulfilled' ? pumpData.value : null;
    const gecko = geckoData.status === 'fulfilled' ? geckoData.value : null;
    const helius = heliusData.status === 'fulfilled' ? heliusData.value : null;

    // ── Real tweet velocity (RapidAPI) if available, null otherwise ──
    const symbol = dex?.baseToken?.symbol ?? tokenAddress.slice(0, 6);
    const tweetVelocity = await this.social.getTweetVelocity(symbol, tokenAddress);

    // Fetch slower enrichment signals in parallel so scan latency is bounded by the slowest source.
    const dexSocials = dex?.info?.socials ?? null;
    const [tgResult, blockDensityResult, aiSentimentResult] = await Promise.allSettled([
      this.telegramVelocity.getTelegramVelocity(dexSocials, tokenAddress),
      this.helius.getBlockDensity(tokenAddress),
      this.social.getLastRawTweets(tokenAddress).then(rawTweets =>
        rawTweets ? this.aiSentiment.analyzeSentiment(rawTweets, symbol, tweetVelocity?.twitter_sentiment_score ?? 50, {
          price_change_h1: dex?.priceChange?.h1 ?? 0,
          tx_count_h1: (dex?.txns?.h1?.buys ?? 0) + (dex?.txns?.h1?.sells ?? 0),
          liquidity_usd: dex?.liquidity?.usd ?? 0,
          liquidity_ratio: dex?.liquidity?.usd > 0 ? Number(((dex?.volume?.h24 ?? 0) / dex.liquidity.usd).toFixed(2)) : 0,
        }, tokenAddress) : null,
      ),
    ]);

    const tgVelocity = tgResult.status === 'fulfilled' ? tgResult.value : null;
    const blockDensity = blockDensityResult.status === 'fulfilled' ? blockDensityResult.value : null;
    const rawAiSentiment = aiSentimentResult.status === 'fulfilled' ? aiSentimentResult.value : null;
    const txMomentum = this.analyzeTxMomentum(dex);
    const [flow15m, quoteSlippage] = await Promise.all([
      this.analyzeRollingFlow15m(tokenAddress, txMomentum),
      this.fetchJupiterQuoteSlippage(tokenAddress),
    ]);
    const txContext: VelocityTxContext = {
      ...txMomentum,
      buy_volume_m15: flow15m.buy_volume_m15,
      sell_volume_m15: flow15m.sell_volume_m15,
      quote_slippage_bps_small: quoteSlippage.small_bps,
      quote_slippage_bps_medium: quoteSlippage.medium_bps,
      quote_slippage_bps_large: quoteSlippage.large_bps,
      quote_slippage_risk: quoteSlippage.risk,
    };
    const aiSentiment = this.applyVelocityOverrides(rawAiSentiment, txContext, blockDensity);

    this.logger.debug(
      `[Velocity] Sources: dex=${!!dex} pump=${!!pump} gecko=${!!gecko} tweets=${!!tweetVelocity} tg=${!!tgVelocity} blocks=${!!blockDensity} ai=${!!aiSentiment}`,
    );

    // Component scores separate social hype, sentiment drift, and on-chain velocity before weighting.
    const socialPump = this.analyzePumpFun(pump);              // Pump.fun
    const sentimentData = await this.analyzeSentimentShift(gecko, tokenAddress); // Pillar 3: Δsentiment
    const heliusVelocity = this.analyzeHelius(helius);

    // Detect flags — all pillars + new sources contribute
    const flags = this.detectFlags(txContext, socialPump, sentimentData, tweetVelocity, tgVelocity, blockDensity, aiSentiment);

    // Store time-series for delta analysis
    await this.storeTimeSeries(tokenAddress, dex, pump);

    // Final score — weighted by 3 pillars + new data
    const velocityScore = this.calculateScore(txContext, socialPump, sentimentData, heliusVelocity, flags, tweetVelocity);
    const hypeDetected = flags.some((f) => f.type === 'DEGEN_PLAY');

    return {
      velocity_score: Math.min(100, Math.max(0, velocityScore)),
      hype_detected: hypeDetected,
      sources: {
        dexscreener: !!dex,
        pumpfun: !!pump,
        lunarcrush: !!gecko,
        twitter: !!tweetVelocity,
        telegram: !!tgVelocity,
        helius_blocks: !!blockDensity,
        ai_sentiment: !!aiSentiment,
      },
      // DexScreener metrics
      tx_count_m5: (dex?.txns?.m5?.buys ?? 0) + (dex?.txns?.m5?.sells ?? 0),
      tx_count_h1: (dex?.txns?.h1?.buys ?? 0) + (dex?.txns?.h1?.sells ?? 0),
      tx_count_h6: (dex?.txns?.h6?.buys ?? 0) + (dex?.txns?.h6?.sells ?? 0),
      price_change_h1: dex?.priceChange?.h1 ?? 0,
      market_cap: dex?.marketCap ?? null,
      fdv: dex?.fdv ?? null,
      volume_m5: dex?.volume?.m5 ?? 0,
      volume_h1: dex?.volume?.h1 ?? 0,
      volume_h24: dex?.volume?.h24 ?? 0,
      has_paid_boost: (dex?.boosts?.active ?? 0) > 0,
      // V_pressure compares estimated buy volume against sell volume; values below 1 indicate sell pressure.
      v_pressure: txContext.v_pressure,
      buy_volume_m5: txContext.buy_volume_m5,
      sell_volume_m5: txContext.sell_volume_m5,
      buy_volume_m15: flow15m.buy_volume_m15,
      sell_volume_m15: flow15m.sell_volume_m15,
      buy_volume_h1: txContext.buy_volume_h1,
      sell_volume_h1: txContext.sell_volume_h1,
      // Liquidity depth flags tokens where volume can move price sharply due to shallow pools.
      liquidity_ratio: txContext.liquidity_ratio,
      liquidity_to_mcap_ratio: txContext.liquidity_to_mcap_ratio,
      quote_slippage_bps_small: quoteSlippage.small_bps,
      quote_slippage_bps_medium: quoteSlippage.medium_bps,
      quote_slippage_bps_large: quoteSlippage.large_bps,
      quote_slippage_risk: quoteSlippage.risk,
      is_flash_crash_risk: txContext.is_flash_crash_risk,
      liquidity_usd: dex?.liquidity?.usd ?? 0,
      // Pump.fun metrics
      pump_reply_count: pump?.reply_count ?? 0,
      pump_is_graduated: pump?.raydium_pool != null,
      pump_king_of_hill: pump?.king_of_the_hill_timestamp != null,
      // Pillar 3: Sentiment (CoinGecko)
      galaxy_score: sentimentData.sentiment_up ?? null,
      social_volume: sentimentData.reddit_active ?? null,
      sentiment_shift: sentimentData.sentiment_shift,
      sentiment_prev: sentimentData.prev_sentiment,
      sentiment_label: sentimentData.shift_label,
      is_sentiment_crash: sentimentData.is_sentiment_crash,
      // Pillar 1: Real tweet velocity (RapidAPI)
      tweet_growth_rate: tweetVelocity?.growth_rate ?? null,
      tweet_unique_users: tweetVelocity?.current_unique ?? null,
      tweet_bot_ratio: tweetVelocity?.bot_ratio ?? null,
      tweet_is_bot_pump: tweetVelocity?.is_bot_pump ?? false,
      // KOL detection deduplicates authors and weights reach by follower count.
      kol_count: tweetVelocity?.kol_count ?? 0,
      kol_names: tweetVelocity?.kol_names ?? [],
      is_organized_shill: tweetVelocity?.is_organized_shill ?? false,
      weighted_shill_reach: tweetVelocity?.weighted_shill_reach ?? 0,
      shill_size: tweetVelocity?.shill_size ?? 'NONE',
      // Engagement decay compares recent likes and retweets against older tweets in the same sample.
      avg_engagement_per_tweet: tweetVelocity?.avg_engagement_per_tweet ?? 0,
      engagement_decay_pct: tweetVelocity?.engagement_decay_pct ?? 0,
      is_engagement_dying: tweetVelocity?.is_engagement_dying ?? false,
      // Twitter-native Sentiment (real-time)
      twitter_sentiment_score: tweetVelocity?.twitter_sentiment_score ?? 50,
      is_twitter_sentiment_negative: tweetVelocity?.is_twitter_sentiment_negative ?? false,
      // Telegram velocity tracks group growth or churn as a community health signal.
      tg_group: tgVelocity?.group_username ?? null,
      tg_member_count: tgVelocity?.member_count ?? null,
      tg_member_growth_rate: tgVelocity?.member_growth_rate ?? null,
      tg_member_delta: tgVelocity?.member_delta ?? null,
      is_tg_surging: tgVelocity?.is_member_surging ?? false,
      is_tg_declining: tgVelocity?.is_member_declining ?? false,
      // Block density detects same-slot bursts and consecutive buy-heavy blocks that can precede volatility.
      block_density_pct: blockDensity?.density_pct ?? null,
      blocks_with_swaps: blockDensity?.blocks_with_swaps ?? null,
      consecutive_buy_blocks: blockDensity?.consecutive_buy_blocks ?? null,
      max_swaps_in_slot: blockDensity?.max_swaps_in_slot ?? null,
      burst_slot_count: blockDensity?.burst_slot_count ?? null,
      same_slot_bundle_detected: blockDensity?.same_slot_bundle_detected ?? false,
      is_god_candle: blockDensity?.is_god_candle ?? false,
      // AI sentiment re-reads top tweets for sarcasm, fear, and narrative context missed by keyword scoring.
      ai_sentiment: aiSentiment?.sentiment ?? null,
      ai_confidence: aiSentiment?.confidence ?? null,
      ai_summary: aiSentiment?.summary ?? null,
      ai_sarcasm_detected: aiSentiment?.sarcasm_detected ?? false,
      ai_key_concerns: aiSentiment?.key_concerns ?? [],
      ai_dominant_narrative: aiSentiment?.dominant_narrative ?? null,
      // Flags
      flags,
      // Legacy fields
      tweet_velocity: {
        growth_rate: tweetVelocity?.growth_rate ?? socialPump.reply_growth_rate,
        unique_user_rate: tweetVelocity?.unique_user_rate ?? 0,
        bot_ratio: tweetVelocity?.bot_ratio ?? txMomentum.bot_ratio_proxy,
      },
      holder_momentum: this.buildHolderMomentum(dex, socialPump),
      // Instant charts
      tweet_timeline: tweetVelocity?.tweet_timeline ?? [],
      dex_buy_timeline: this.buildDexTimeline(dex),
      snapshots: { tweets: [], holders: [] },
    };
  }

  // DexScreener provides live transaction counts, volume, liquidity, and paid-boost metadata.

  private async fetchDexScreener(tokenAddress: string): Promise<any> {
    const cacheKey = `dex:${tokenAddress}`;
    const cached = await this.redis.cacheGet<any>(cacheKey);
    if (cached) return cached;

    const res = await firstValueFrom(
      this.http.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
        timeout: 4000,
      } as any),
    ) as AxiosResponse<any>;

    const pairs = res.data?.pairs ?? [];
    if (pairs.length === 0) return null;

    // Get the most liquid Solana pair
    const solanaPairs = pairs.filter((p: any) => p.chainId === 'solana');
    const bestPair = solanaPairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

    if (!bestPair) return null;

    await this.redis.cacheSet(cacheKey, bestPair, 30); // 30s cache
    this.logger.debug(
      `[DEXSCREENER] ${tokenAddress} | h1_txns=${(bestPair.txns?.h1?.buys ?? 0) + (bestPair.txns?.h1?.sells ?? 0)} | priceChange_h1=${bestPair.priceChange?.h1}%`,
    );
    return bestPair;
  }

  private async fetchJupiterQuoteSlippage(tokenAddress: string): Promise<QuoteSlippage> {
    const solMint = 'So11111111111111111111111111111111111111112';
    const sizes = [0.1, 1, 5];
    const cacheKey = `jup_slippage:${tokenAddress}`;
    const cached = await this.redis.cacheGet<QuoteSlippage>(cacheKey);
    if (cached) return cached;

    const bps = await Promise.all(sizes.map(async (size) => {
      try {
        const amount = Math.round(size * 1_000_000_000);
        const res = await firstValueFrom(
          this.http.get('https://quote-api.jup.ag/v6/quote', {
            timeout: 2500,
            params: {
              inputMint: solMint,
              outputMint: tokenAddress,
              amount,
              slippageBps: 500,
              onlyDirectRoutes: false,
            },
          } as any),
        ) as AxiosResponse<any>;
        const impactPct = Number(res.data?.priceImpactPct);
        return Number.isFinite(impactPct) ? Math.round(impactPct * 10000) : null;
      } catch {
        return null;
      }
    }));

    const maxBps = Math.max(...bps.filter((value): value is number => value != null), 0);
    const result: QuoteSlippage = {
      small_bps: bps[0],
      medium_bps: bps[1],
      large_bps: bps[2],
      risk: maxBps >= 1500 ? 90 : maxBps >= 800 ? 75 : maxBps >= 400 ? 55 : maxBps >= 200 ? 35 : 0,
    };
    await this.redis.cacheSet(cacheKey, result, 30);
    return result;
  }

  // ── Source 2: Pump.fun ─────────────────────────────────────────────────────

  private async fetchPumpFun(tokenAddress: string): Promise<any> {
    const cacheKey = `pump:${tokenAddress}`;
    const cached = await this.redis.cacheGet<any>(cacheKey);
    if (cached) return cached;

    try {
      const res = await firstValueFrom(
        this.http.get(`https://frontend-api.pump.fun/coins/${tokenAddress}`, {
          timeout: 3000,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        } as any),
      ) as AxiosResponse<any>;

      const data = res.data;
      await this.redis.cacheSet(cacheKey, data, 30);
      this.logger.debug(
        `[PUMPFUN] ${tokenAddress} | replies=${data?.reply_count} | graduated=${!!data?.raydium_pool} | king=${!!data?.king_of_the_hill_timestamp}`,
      );
      return data;
    } catch {
      return null; // Token not on Pump.fun — silent
    }
  }

  // ── Source 3: CoinGecko (replaces LunarCrush) ────────────────────────────
  // Free, no API key, returns sentiment_votes_up_percentage + community data

  private async fetchCoinGecko(tokenAddress: string): Promise<any> {
    const cacheKey = `gecko:${tokenAddress}`;
    const cached = await this.redis.cacheGet<any>(cacheKey);
    if (cached) return cached;

    try {
      // First fetch the DexScreener pair to get the symbol for CoinGecko lookup
      const dexRes = await firstValueFrom(
        this.http.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
          timeout: 3000,
        } as any),
      ) as AxiosResponse<any>;
      const symbol = dexRes.data?.pairs?.[0]?.baseToken?.symbol?.toLowerCase();
      if (!symbol) return null;

      // Search CoinGecko for the token by symbol
      const searchRes = await firstValueFrom(
        this.http.get(`https://api.coingecko.com/api/v3/coins/${symbol}?localization=false&tickers=false&community_data=true&developer_data=false`, {
          timeout: 4000,
        } as any),
      ) as AxiosResponse<any>;

      const data = searchRes.data;
      if (!data || data.error) return null;

      const sentiment = data.sentiment_votes_up_percentage ?? null;
      const reddit = data.community_data?.reddit_accounts_active_48h ?? 0;

      await this.redis.cacheSet(cacheKey, { sentiment_up: sentiment, reddit_active: reddit }, 120);
      this.logger.debug(`[COINGECKO] ${symbol} | sentiment_up=${sentiment}% | reddit_active=${reddit}`);
      return { sentiment_up: sentiment, reddit_active: reddit };
    } catch {
      return null;
    }
  }

  // DexScreener momentum converts raw swaps, volume, and liquidity into sell-pressure and slippage risk signals.

  private analyzeTxMomentum(dex: any) {
    if (!dex) return {
      tx_surge: false, bot_ratio_proxy: 0, price_spike: false, has_boost: false,
      h1_txns: 0, m5_txns: 0, price_change_h1: 0,
      v_pressure: 1, liquidity_ratio: 0, liquidity_to_mcap_ratio: null, is_flash_crash_risk: false,
      buy_volume_m5: 0, sell_volume_m5: 0, buy_volume_m15: 0, sell_volume_m15: 0, buy_volume_h1: 0, sell_volume_h1: 0,
      quote_slippage_bps_small: null, quote_slippage_bps_medium: null, quote_slippage_bps_large: null, quote_slippage_risk: 0,
    };

    const m5 = (dex.txns?.m5?.buys ?? 0) + (dex.txns?.m5?.sells ?? 0);
    const h1 = (dex.txns?.h1?.buys ?? 0) + (dex.txns?.h1?.sells ?? 0);
    const h6 = (dex.txns?.h6?.buys ?? 0) + (dex.txns?.h6?.sells ?? 0);
    const avgH1PerHour = h6 / 6;

    // Tx spike: last hour had 3x more txns than 6h average
    const txSurge = avgH1PerHour > 0 && h1 > avgH1PerHour * 3;

    // Bot proxy: sell ratio — bots often create sell pressure alongside buy spikes
    const totalH1 = h1;
    const sellRatio = totalH1 > 0 ? (dex.txns?.h1?.sells ?? 0) / totalH1 : 0.5;
    const botRatioProxy = sellRatio > 0.8 ? 8 : sellRatio > 0.65 ? 4 : 1;

    const priceChangeH1 = dex.priceChange?.h1 ?? 0;
    const priceSpike = Math.abs(priceChangeH1) > 30;

    // DexScreener reports total hourly volume, so buy/sell volume is estimated from transaction-side ratios.
    const volumeM5 = dex.volume?.m5 ?? 0;
    const volumeH1 = dex.volume?.h1 ?? 0;
    const buyPctM5 = m5 > 0 ? (dex.txns?.m5?.buys ?? 0) / m5 : 0.5;
    const buyPct = totalH1 > 0 ? (dex.txns?.h1?.buys ?? 0) / totalH1 : 0.5;
    const buyVolumeM5 = volumeM5 * buyPctM5;
    const sellVolumeM5 = volumeM5 * (1 - buyPctM5);
    const buyVolumeH1 = volumeH1 * buyPct;
    const sellVolumeH1 = volumeH1 * (1 - buyPct);

    // V_pressure above 1 means demand dominates; below 1 means sell pressure dominates.
    const vPressure = sellVolumeH1 > 0 ? buyVolumeH1 / sellVolumeH1 : buyVolumeH1 > 0 ? 10 : 1;

    // High volume relative to liquidity indicates shallow exits and high slippage under stress.
    const liquidityUsd = dex.liquidity?.usd ?? 0;
    const marketCap = dex.marketCap ?? dex.fdv ?? 0;
    const volumeH24 = dex.volume?.h24 ?? 0;
    const liquidityRatio = liquidityUsd > 0 ? volumeH24 / liquidityUsd : 0;
    const liquidityToMcapRatio = marketCap > 0 ? liquidityUsd / marketCap : null;

    // Volume above 5x liquidity is treated as flash-crash risk when pool liquidity is small.
    const isFlashCrashRisk = liquidityRatio > 5 && liquidityUsd < 50000;

    return {
      tx_surge: txSurge,
      bot_ratio_proxy: botRatioProxy,
      price_spike: priceSpike,
      has_boost: (dex.boosts?.active ?? 0) > 0,
      h1_txns: h1,
      m5_txns: m5,
      price_change_h1: priceChangeH1,
      v_pressure: Number(vPressure.toFixed(2)),
      buy_volume_m5: Math.round(buyVolumeM5),
      sell_volume_m5: Math.round(sellVolumeM5),
      buy_volume_h1: Math.round(buyVolumeH1),
      sell_volume_h1: Math.round(sellVolumeH1),
      liquidity_ratio: Number(liquidityRatio.toFixed(2)),
      liquidity_to_mcap_ratio: liquidityToMcapRatio == null ? null : Number(liquidityToMcapRatio.toFixed(4)),
      quote_slippage_bps_small: 0,
      quote_slippage_bps_medium: 0,
      quote_slippage_bps_large: 0,
      quote_slippage_risk: 0,
      is_flash_crash_risk: isFlashCrashRisk,
    };
  }

  private async analyzeRollingFlow15m(
    tokenAddress: string,
    txMomentum: ReturnType<VelocityService['analyzeTxMomentum']>,
  ): Promise<{ buy_volume_m15: number; sell_volume_m15: number }> {
    const now = Date.now();
    await Promise.all([
      this.redis.addTimeSeriesPoint('buy_volume_m5', tokenAddress, txMomentum.buy_volume_m5, now),
      this.redis.addTimeSeriesPoint('sell_volume_m5', tokenAddress, txMomentum.sell_volume_m5, now),
    ]);

    const from = now - 15 * 60 * 1000;
    const [buyPoints, sellPoints] = await Promise.all([
      this.redis.getTimeSeriesRange('buy_volume_m5', tokenAddress, from, now),
      this.redis.getTimeSeriesRange('sell_volume_m5', tokenAddress, from, now),
    ]);

    const latestByBucket = (points: { timestamp: number; value: number }[]) => {
      const buckets = new Map<number, number>();
      for (const point of points) buckets.set(Math.floor(point.timestamp / 300000), point.value);
      return [...buckets.values()].reduce((sum, value) => sum + value, 0);
    };

    return {
      buy_volume_m15: Math.round(latestByBucket(buyPoints)),
      sell_volume_m15: Math.round(latestByBucket(sellPoints)),
    };
  }

  // Holder momentum compares buyer growth against volume growth to detect distribution without broad accumulation.
  // H1 buys versus H6 average estimates whether new wallets are arriving faster than baseline demand.
  // H24 volume versus H1 buyers highlights money flow that is not matched by wallet accumulation.

  private applyVelocityOverrides(
    aiSentiment: AISentimentResult | null,
    txMomentum: VelocityTxContext,
    blockDensity: any,
  ): AISentimentResult | null {
    const hasCrashContext =
      txMomentum.price_change_h1 <= -50 ||
      txMomentum.is_flash_crash_risk ||
      txMomentum.v_pressure < 0.5 ||
      blockDensity?.is_god_candle;

    if (!hasCrashContext) return aiSentiment;

    const crashSummary = txMomentum.price_change_h1 <= -50
      ? `Token dropped ${Math.abs(txMomentum.price_change_h1).toFixed(0)}% in 1h; social activity is crash context, not bullish momentum.`
      : 'Market structure shows high volatility and exit-liquidity risk; bullish sentiment is suppressed.';

    return {
      sentiment: 'BEARISH',
      confidence: Math.max(aiSentiment?.confidence ?? 0, txMomentum.price_change_h1 <= -90 ? 95 : 88),
      summary: crashSummary,
      sarcasm_detected: aiSentiment?.sarcasm_detected ?? false,
      key_concerns: Array.from(new Set([
        ...(aiSentiment?.key_concerns ?? []),
        txMomentum.price_change_h1 <= -50 ? 'Severe price crash' : 'High volatility risk',
        txMomentum.is_flash_crash_risk ? 'Flash-crash liquidity risk' : null,
        txMomentum.v_pressure < 0.5 ? 'Sell pressure exceeds buy pressure' : null,
      ].filter(Boolean) as string[])).slice(0, 5),
      dominant_narrative: aiSentiment?.dominant_narrative ?? 'Crash and exit-liquidity risk context.',
    };
  }

  private analyzePumpFun(pump: any) {
    if (!pump) return {
      reply_growth_rate: 0,
      holder_growth_rate: 0,
      holder_declining: false,
      is_koth: false,
      is_graduated: false,
      reply_count: 0,
    };

    const replyCount = pump.reply_count ?? 0;
    const holderCount = pump.holder_count ?? 0;
    const marketCap = pump.usd_market_cap ?? 0;

    // Normalize: pump.fun tokens with high reply count relative to market cap = organic hype
    const engagementRatio = marketCap > 0 ? replyCount / (marketCap / 1000) : 0;

    return {
      reply_growth_rate: Math.min(100, engagementRatio * 10),
      holder_growth_rate: holderCount > 200 ? 30 : holderCount > 50 ? 10 : 0,
      holder_declining: false,
      is_koth: !!pump.king_of_the_hill_timestamp,
      is_graduated: !!pump.raydium_pool,
      reply_count: replyCount,
    };
  }

  // Sentiment shift compares current social sentiment against the previous scan to catch fear before price fully reacts.
  // Redis stores the previous sentiment snapshot with a short TTL so stale scans do not affect new tokens.

  private async analyzeSentimentShift(gecko: any, tokenAddress: string) {
    const result = {
      sentiment_up: gecko?.sentiment_up ?? null as number | null,
      reddit_active: gecko?.reddit_active ?? null as number | null,
      risk_contribution: 0,
      // Pillar 3 fields:
      sentiment_shift: 0,            // Δ from previous scan (negative = fear rising)
      prev_sentiment: null as number | null,
      is_sentiment_crash: false,     // sudden shift ≥ 20pt
      shift_label: 'STABLE' as 'STABLE' | 'IMPROVING' | 'DECLINING' | 'CRASH',
    };

    if (gecko?.sentiment_up == null) return result;

    const current = gecko.sentiment_up; // 0-100%

    // Load previous sentiment from Redis
    const prevKey = `sentiment_prev:${tokenAddress}`;
    const prevData = await this.redis.cacheGet<{ sentiment_up: number; timestamp: number }>(prevKey);

    // Store current as next "previous" (TTL 30 minutes)
    await this.redis.cacheSet(prevKey, { sentiment_up: current, timestamp: Date.now() }, 1800);

    if (prevData) {
      result.prev_sentiment = prevData.sentiment_up;
      result.sentiment_shift = current - prevData.sentiment_up;
      // Δ = from 70% → 48% = -22 (fear rising rapidly)

      if (result.sentiment_shift <= -20) {
        result.is_sentiment_crash = true;
        result.shift_label = 'CRASH';
      } else if (result.sentiment_shift <= -10) {
        result.shift_label = 'DECLINING';
      } else if (result.sentiment_shift >= 10) {
        result.shift_label = 'IMPROVING';
      }

      this.logger.debug(
        `[SENTIMENT] ${tokenAddress} | now=${current}% prev=${prevData.sentiment_up}% Δ=${result.sentiment_shift.toFixed(1)} | ${result.shift_label}`,
      );
    }

    // Static risk: low sentiment_up = fear/bearish → higher risk
    result.risk_contribution = current < 40 ? Math.max(0, 50 - current) * 0.3 : 0;

    return result;
  }

  // ── Analysis: Helius holder snapshots (legacy) ───────────────────────────

  private analyzeHelius(helius: any) {
    if (!helius) return { holder_declining: false, bot_ratio: 0 };

    const { tweet_snapshots = [], holder_snapshots = [] } = helius;

    if (tweet_snapshots.length < 2) return { holder_declining: false, bot_ratio: 0 };

    const oldest = tweet_snapshots[0];
    const latest = tweet_snapshots[tweet_snapshots.length - 1];
    const growth = oldest.count > 0 ? ((latest.count - oldest.count) / oldest.count) * 100 : 0;
    const userGrowth = oldest.unique_users > 0
      ? ((latest.unique_users - oldest.unique_users) / oldest.unique_users) * 100 : 0;
    const botRatio = userGrowth > 0 ? growth / userGrowth : growth > 0 ? 100 : 0;

    let holderDeclining = false;
    if (holder_snapshots.length >= 3) {
      const mid = holder_snapshots[Math.floor(holder_snapshots.length / 2)];
      const firstHalf = (mid.count - holder_snapshots[0].count) / Math.max(1, holder_snapshots[0].count);
      const secondHalf = (holder_snapshots.at(-1).count - mid.count) / Math.max(1, mid.count);
      holderDeclining = secondHalf < firstHalf * 0.5;
    }

    return { holder_declining: holderDeclining, bot_ratio: botRatio };
  }

  // Flag detection turns raw velocity metrics into user-facing risk signals.

  private detectFlags(
    txMomentum: VelocityTxContext,
    pumpData: ReturnType<VelocityService['analyzePumpFun']>,
    sentimentData: Awaited<ReturnType<VelocityService['analyzeSentimentShift']>>,
    tweetData?: { growth_rate: number; bot_ratio: number; is_bot_pump: boolean; is_organic: boolean;
      kol_count?: number; is_organized_shill?: boolean; is_engagement_dying?: boolean;
      engagement_decay_pct?: number; kol_names?: string[] } | null,
    tgData?: TelegramVelocityData | null,
    blockData?: BlockDensityData | null,
    aiData?: AISentimentResult | null,
  ): VelocityFlag[] {
    const flags: VelocityFlag[] = [];

    // ── PILLAR 1: Tweet Velocity → BOT_PUMP detection ──
    if (tweetData?.is_bot_pump) {
      flags.push({
        type: 'BOT_PUMP',
        severity: 'HIGH',
        description: `Tweets grew ${tweetData.growth_rate.toFixed(0)}% while unique users barely moved (bot_ratio=${tweetData.bot_ratio.toFixed(1)}). Narrative may be bot-amplified.`,
      });
    } else if (!tweetData && txMomentum.tx_surge && txMomentum.bot_ratio_proxy > 5) {
      flags.push({
        type: 'BOT_PUMP',
        severity: 'MEDIUM',
        description: 'Transactions surged with an abnormal sell ratio — possible bot wash trading.',
      });
    }

    // KOL shill flags multiple influential accounts posting in the same scan window.
    if (tweetData?.is_organized_shill) {
      flags.push({
        type: 'KOL_SHILL',
        severity: 'HIGH',
        description: `${tweetData.kol_count} KOLs posted in the same window — possible coordinated shill: ${tweetData.kol_names?.slice(0, 3).join(', ')}.`,
      });
    }

    // Engagement decay flags fading attention when recent engagement trails older tweets in the sample.
    if (tweetData?.is_engagement_dying) {
      flags.push({
        type: 'ENGAGEMENT_DECAY',
        severity: 'MEDIUM',
        description: `Engagement is fading — recent likes/retweets dropped ${Math.abs(tweetData.engagement_decay_pct ?? 0).toFixed(0)}% versus the previous window.`,
      });
    }

    // Flash-crash flags combine shallow liquidity with high turnover or quote slippage.
    if (txMomentum.is_flash_crash_risk) {
      flags.push({
        type: 'FLASH_CRASH',
        severity: 'HIGH',
        description: `Volume is ${txMomentum.liquidity_ratio.toFixed(1)}x liquidity. Slippage risk is extreme and flash-crash risk is elevated.`,
      });
    }
    if (txMomentum.quote_slippage_risk >= 75) {
      flags.push({
        type: 'QUOTE_SLIPPAGE',
        severity: 'HIGH',
        description: `Jupiter quote shows high price impact. Medium trade: ${txMomentum.quote_slippage_bps_medium ?? 'n/a'} bps, large trade: ${txMomentum.quote_slippage_bps_large ?? 'n/a'} bps.`,
      });
    } else if (txMomentum.quote_slippage_risk >= 55) {
      flags.push({
        type: 'QUOTE_SLIPPAGE',
        severity: 'MEDIUM',
        description: `Jupiter quote shows meaningful slippage. Large trade impact: ${txMomentum.quote_slippage_bps_large ?? 'n/a'} bps.`,
      });
    }

    // ── PILLAR 2: Holder Momentum → Silent Dump detection ──
    if (txMomentum.tx_surge && txMomentum.bot_ratio_proxy > 3) {
      flags.push({
        type: 'HOLDER_LAG',
        severity: 'MEDIUM',
        description: 'Volume surged while sells dominate — possible silent distribution.',
      });
    }

    // Weak V_pressure means estimated sell volume is materially stronger than buy volume.
    if (txMomentum.v_pressure < 0.5 && txMomentum.h1_txns > 50) {
      flags.push({
        type: 'DUMP_RISK',
        severity: 'HIGH',
        description: `Sell pressure is ${(1 / txMomentum.v_pressure).toFixed(1)}x buy pressure (V_pressure=${txMomentum.v_pressure}). Demand is weakening.`,
      });
    }

    // Sentiment crash flags a sharp negative shift from the previous scan, before price may reflect it.
    if (sentimentData.is_sentiment_crash) {
      flags.push({
        type: 'SENTIMENT_SHIFT',
        severity: 'HIGH',
        description: `Sentiment collapsed by ${Math.abs(sentimentData.sentiment_shift).toFixed(0)}pt. Fear is spreading before price fully reflects it.`,
      });
    } else if (sentimentData.shift_label === 'DECLINING') {
      flags.push({
        type: 'SENTIMENT_SHIFT',
        severity: 'MEDIUM',
        description: `Sentiment is turning negative — down ${Math.abs(sentimentData.sentiment_shift).toFixed(0)}pt.`,
      });
    }

    // ── Cross-pillar flags ──

    // DEGEN_PLAY marks organic high-risk momentum separately from hard-block risk so traders can decide intentionally.
    const isOrganicTwitter = tweetData?.is_organic && tweetData.growth_rate > 100;
    const isOrganicTx = !tweetData && txMomentum.tx_surge && txMomentum.bot_ratio_proxy < 3 && txMomentum.price_change_h1 > 10 && pumpData.reply_growth_rate > 20;
    if (isOrganicTwitter || isOrganicTx) {
      flags.push({
        type: 'DEGEN_PLAY',
        severity: 'MEDIUM',
        description: isOrganicTwitter
          ? `Organic Twitter hype — tweets grew ${tweetData!.growth_rate.toFixed(0)}%. High risk, high reward.`
          : 'Organic hype detected from trading and community activity. High risk, high reward.',
      });
    }

    // Pump.fun signals
    if ((pumpData as any).is_koth) {
      flags.push({ type: 'DEGEN_PLAY', severity: 'MEDIUM', description: 'King of the Hill on Pump.fun.' });
    }
    if ((pumpData as any).is_graduated) {
      flags.push({ type: 'HEALTHY', severity: 'LOW', description: 'Graduated from Pump.fun to Raydium.' });
    }
    if (txMomentum.has_boost) {
      flags.push({ type: 'PAID_PROMO', severity: 'HIGH', description: 'Token is using DexScreener paid boosts. This often appears when teams seek exit liquidity.' });
    }
    if (txMomentum.price_change_h1 < -30) {
      flags.push({ type: 'DUMP_RISK', severity: 'HIGH', description: `Price dropped ${txMomentum.price_change_h1.toFixed(0)}% in the last hour.` });
    }

    // Telegram velocity adds community growth and churn to social risk scoring.
    if (tgData?.is_member_surging) {
      flags.push({
        type: 'TG_SURGE',
        severity: 'MEDIUM',
        description: `Telegram grew ${tgData.member_growth_rate.toFixed(1)}% (+${tgData.member_delta} members). Community expansion is accelerating.`,
      });
    }
    if (tgData?.is_member_declining) {
      flags.push({
        type: 'TG_DECLINE',
        severity: 'HIGH',
        description: `Telegram lost ${Math.abs(tgData.member_delta)} members (${tgData.member_growth_rate.toFixed(1)}%). Community is shrinking.`,
      });
    }

    // Block density catches bursty same-slot behavior and consecutive buy-heavy blocks.
    if (blockData?.is_god_candle) {
      flags.push({
        type: 'GOD_CANDLE',
        severity: 'HIGH',
        description: `UNSTABLE PUMP RISK: ${blockData.consecutive_buy_blocks} consecutive buy-heavy blocks. Breakout or rug volatility risk is elevated.`,
      });
    } else if (blockData && blockData.density_pct >= 60) {
      flags.push({
        type: 'GOD_CANDLE',
        severity: 'MEDIUM',
        description: `Block density ${blockData.density_pct}% — swaps appeared in ${blockData.blocks_with_swaps}/${blockData.total_blocks_checked} checked blocks. On-chain activity is extremely high.`,
      });
    }
    if (blockData?.same_slot_bundle_detected) {
      flags.push({
        type: 'SAME_SLOT_BUNDLE',
        severity: blockData.max_swaps_in_slot >= 8 ? 'HIGH' : 'MEDIUM',
        description: `Same-slot burst detected: max ${blockData.max_swaps_in_slot} swaps in one slot across ${blockData.burst_slot_count} burst slots. Possible bundle/sniper activity.`,
      });
    }

    // AI sentiment can override keyword scores when sarcasm, fear, or crash context changes interpretation.
    if (aiData) {
      if (aiData.sentiment === 'BEARISH' && aiData.confidence >= 60) {
        flags.push({
          type: 'AI_BEARISH',
          severity: aiData.confidence >= 80 ? 'HIGH' : 'MEDIUM',
          description: `AI detected BEARISH sentiment (${aiData.confidence}% confidence): "${aiData.summary}"` +
            (aiData.sarcasm_detected ? ' Sarcasm/irony detected.' : ''),
        });
      }
      if (aiData.sarcasm_detected && aiData.sentiment !== 'BULLISH') {
        flags.push({
          type: 'AI_BEARISH',
          severity: 'MEDIUM',
          description: `AI detected sarcasm in tweets — keyword scoring may be misleading. Effective sentiment: ${aiData.sentiment}.`,
        });
      }
    }

    return flags;
  }

  // ── Score Calculation — 3 Pillar Weighted Formula ──────────────────────────
  //
  // PILLAR 1: Tweet Velocity (bot detection)         — Weight 35%
  // PILLAR 2: Holder Momentum (silent dump)          — Weight 30%
  // PILLAR 3: Sentiment Shift (fear detection)       — Weight 20%
  // EXTRA:    Flag modifiers + on-chain signals      — Weight 15%
  //
  // Score 0-100: Higher = Riskier

  private calculateScore(
    tx: VelocityTxContext,
    pump: ReturnType<VelocityService['analyzePumpFun']>,
    sentiment: Awaited<ReturnType<VelocityService['analyzeSentimentShift']>>,
    helius: ReturnType<VelocityService['analyzeHelius']>,
    flags: VelocityFlag[],
    tweetData?: { bot_ratio: number; growth_rate: number; is_bot_pump: boolean; is_twitter_sentiment_negative?: boolean } | null,
  ): number {

    // === PILLAR 1: Tweet Velocity (0-100 sub-score) ===
    // First scan: fall back to DexScreener sell ratio
    const isFirstScan = tweetData != null && tweetData.growth_rate === 0;
    const effectiveBotRatio = (tweetData && !isFirstScan)
      ? tweetData.bot_ratio
      : tx.bot_ratio_proxy;

    let p1Score = 0;
    if (effectiveBotRatio > 8)      p1Score = 90;  // Extreme bot
    else if (effectiveBotRatio > 5) p1Score = 65;  // Suspicious
    else if (effectiveBotRatio > 3) p1Score = 40;  // Moderate
    else if (effectiveBotRatio > 1.5) p1Score = 15; // Slightly elevated
    else p1Score = 5;  // Organic

    // Holder momentum and liquidity produce the second 0-100 risk sub-score.
    let p2Score = 0;
    const sellRatio = tx.bot_ratio_proxy;
    if (sellRatio > 5) p2Score += 40;
    else if (sellRatio > 3) p2Score += 20;
    if (tx.tx_surge) p2Score += 15;
    if (tx.price_change_h1 < -30) p2Score += 25;
    else if (tx.price_change_h1 < -15) p2Score += 12;
    if (helius.holder_declining) p2Score += 15;
    // Low V_pressure adds risk because sell volume is dominating estimated buy volume.
    if (tx.v_pressure < 0.5) p2Score += 20;       // Heavy sell pressure
    else if (tx.v_pressure < 0.8) p2Score += 8;
    // Liquidity fragility adds risk when turnover can overwhelm shallow pools.
    if (tx.is_flash_crash_risk) p2Score += 20;
    else if (tx.liquidity_ratio > 3) p2Score += 10;
    p2Score = Math.min(100, p2Score);

    // Sentiment shift produces the third 0-100 risk sub-score.
    let p3Score = 0;
    if (sentiment.is_sentiment_crash) p3Score = 80;
    else if (sentiment.shift_label === 'DECLINING') p3Score = 45;
    else if (sentiment.shift_label === 'IMPROVING') p3Score = 5;
    p3Score += sentiment.risk_contribution;
    p3Score = Math.min(100, p3Score);

    // === EXTRA: Flag modifiers ===
    let extraScore = 0;
    for (const flag of flags) {
      if (flag.type === 'BOT_PUMP')          extraScore += 20;
      if (flag.type === 'DUMP_RISK')         extraScore += 15;
      if (flag.type === 'SENTIMENT_SHIFT')   extraScore += 15;
      if (flag.type === 'HOLDER_LAG')        extraScore += 10;
      if (flag.type === 'KOL_SHILL')         extraScore += 18;
      if (flag.type === 'ENGAGEMENT_DECAY')  extraScore += 12;
      if (flag.type === 'FLASH_CRASH')       extraScore += 20;
      if (flag.type === 'DEGEN_PLAY')        extraScore -= 5;
      if (flag.type === 'HEALTHY')           extraScore -= 10;
      if (flag.type === 'PAID_PROMO') {
        const boostRisky = tx.v_pressure < 0.8 || tx.price_change_h1 < -15 || tx.liquidity_ratio > 3 || tx.is_flash_crash_risk;
        extraScore += boostRisky ? 25 : 8;
      }
      // Enrichment flags adjust score with community growth, block-density, quote-slippage, and AI context.
      if (flag.type === 'TG_SURGE')          extraScore -= 3;   // organic community growth is positive
      if (flag.type === 'TG_DECLINE')        extraScore += 15;  // community dying
      if (flag.type === 'GOD_CANDLE')        extraScore += 12;  // extreme activity = volatile
      if (flag.type === 'SAME_SLOT_BUNDLE')  extraScore += 18;
      if (flag.type === 'QUOTE_SLIPPAGE')    extraScore += 15;
      if (flag.type === 'AI_BEARISH')        extraScore += 18;  // LLM detected hidden bearish
    }
    // Twitter-native sentiment bonus (real-time, more reliable than CoinGecko for meme)
    if (tweetData?.is_twitter_sentiment_negative) extraScore += 15;

    // === Weighted Final Score ===
    const weightedScore =
      p1Score * 0.35 +  // Tweet velocity
      p2Score * 0.30 +  // Holder momentum
      p3Score * 0.20 +  // Sentiment shift
      Math.max(0, extraScore) * 0.15; // Flags

    let floor = (tx as any).h1_txns > 0 ? 5 : 0;
    if (tx.price_change_h1 <= -90) floor = Math.max(floor, 95);
    else if (tx.price_change_h1 <= -70) floor = Math.max(floor, 90);
    else if (tx.price_change_h1 <= -50) floor = Math.max(floor, 85);
    else if (tx.price_change_h1 <= -30) floor = Math.max(floor, 75);
    if (tx.is_flash_crash_risk) floor = Math.max(floor, 80);
    if ((tx as any).quote_slippage_risk >= 75) floor = Math.max(floor, 75);
    if (tx.v_pressure < 0.5 && tx.price_change_h1 <= -30) floor = Math.max(floor, 80);
    if (flags.some((flag) => flag.type === 'PAID_PROMO') && (tx.price_change_h1 <= -30 || tx.v_pressure < 0.5 || tx.is_flash_crash_risk)) floor = Math.max(floor, 80);
    if (flags.some((flag) => flag.type === 'AI_BEARISH' && flag.severity === 'HIGH')) floor = Math.max(floor, 75);

    return Math.round(Math.max(floor, Math.min(100, weightedScore)));
  }

  // Redis time-series snapshots preserve scan deltas across requests.

  private async storeTimeSeries(tokenAddress: string, dex: any, pump: any) {
    const now = Date.now();
    if (dex) {
      const h1Txns = (dex.txns?.h1?.buys ?? 0) + (dex.txns?.h1?.sells ?? 0);
      await this.redis.addTimeSeriesPoint('tx_h1', tokenAddress, h1Txns, now);
    }
    if (pump?.reply_count != null) {
      await this.redis.addTimeSeriesPoint('pump_replies', tokenAddress, pump.reply_count, now);
    }
  }

  // Holder momentum uses DexScreener buy/sell balance because holder counts are unavailable.
  // H1 buys above the H6 hourly average indicate new demand entering faster than baseline.
  private buildHolderMomentum(dex: any, pumpFallback: any): { growth_rate: number; is_declining: boolean } {
    if (dex?.txns) {
      const h1Buys  = dex.txns.h1?.buys  ?? 0;
      const h1Sells = dex.txns.h1?.sells ?? 0;
      const h6Buys  = dex.txns.h6?.buys  ?? 0;
      const h6Sells = dex.txns.h6?.sells ?? 0;

      const avgH1Buys = h6Buys / 6;

      // Growth rate = how much more buying than 6h average
      const buyGrowth = avgH1Buys > 0
        ? ((h1Buys - avgH1Buys) / avgH1Buys) * 100
        : 0;

      // Declining: sells are outpacing buys significantly
      const sellRatioH1 = (h1Buys + h1Sells) > 0 ? h1Sells / (h1Buys + h1Sells) : 0.5;
      const sellRatioH6 = (h6Buys + h6Sells) > 0 ? h6Sells / (h6Buys + h6Sells) : 0.5;
      const isDeclining = sellRatioH1 > 0.65 && sellRatioH1 > sellRatioH6 + 0.1;

      return { growth_rate: Number(buyGrowth.toFixed(1)), is_declining: isDeclining };
    }
    // Pump.fun holder data is the fallback when DexScreener transaction aggregates are unavailable.
    return { growth_rate: pumpFallback.holder_growth_rate ?? 0, is_declining: pumpFallback.holder_declining ?? false };
  }

  // DexScreener chart buckets approximate trend from aggregate h1, h6, and h24 transaction windows.
  private buildDexTimeline(dex: any): { time: string; buys: number; sells: number }[] {
    if (!dex?.txns) return [];
    // DexScreener gives cumulative h1, h6, h24 aggregates
    // Derive approximate intervals (not exact, but good enough for trend)
    const h1B = dex.txns.h1?.buys  ?? 0;
    const h1S = dex.txns.h1?.sells ?? 0;
    const h6B = dex.txns.h6?.buys  ?? 0;
    const h6S = dex.txns.h6?.sells ?? 0;
    const h24B = dex.txns.h24?.buys  ?? 0;
    const h24S = dex.txns.h24?.sells ?? 0;

    // Approximate  h1-h6 interval and h6-h24 interval
    const midB  = Math.round(Math.max(0, h6B  - h1B)  / 5);
    const midS  = Math.round(Math.max(0, h6S  - h1S)  / 5);
    const oldB  = Math.round(Math.max(0, h24B - h6B)  / 18);
    const oldS  = Math.round(Math.max(0, h24S - h6S)  / 18);

    return [
      { time: 'T-24h', buys: oldB, sells: oldS },
      { time: 'T-6h',  buys: midB, sells: midS },
      { time: 'T-1h',  buys: h1B,  sells: h1S  },
      { time: 'Now',   buys: h1B,  sells: h1S  }, // duplicate last for visual continuity
    ];
  }
} // end VelocityService

// ── Types ─────────────────────────────────────────────────────────────────────

interface VelocityTxContext {
  tx_surge: boolean;
  bot_ratio_proxy: number;
  price_spike: boolean;
  has_boost: boolean;
  h1_txns: number;
  m5_txns: number;
  price_change_h1: number;
  v_pressure: number;
  liquidity_ratio: number;
  liquidity_to_mcap_ratio: number | null;
  is_flash_crash_risk: boolean;
  buy_volume_m5: number;
  sell_volume_m5: number;
  buy_volume_m15: number;
  sell_volume_m15: number;
  buy_volume_h1: number;
  sell_volume_h1: number;
  quote_slippage_bps_small: number | null;
  quote_slippage_bps_medium: number | null;
  quote_slippage_bps_large: number | null;
  quote_slippage_risk: number;
}

interface QuoteSlippage {
  small_bps: number | null;
  medium_bps: number | null;
  large_bps: number | null;
  risk: number;
}

interface VelocityFlag {
  type: 'BOT_PUMP' | 'DUMP_RISK' | 'HEALTHY' | 'DEGEN_PLAY' | 'PAID_PROMO'
    | 'SENTIMENT_SHIFT' | 'HOLDER_LAG' | 'KOL_SHILL' | 'ENGAGEMENT_DECAY' | 'FLASH_CRASH'
    | 'TG_SURGE' | 'TG_DECLINE' | 'GOD_CANDLE' | 'SAME_SLOT_BUNDLE' | 'QUOTE_SLIPPAGE' | 'AI_BEARISH';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  description: string;
}

export interface VelocityAnalysisResult {
  velocity_score: number;
  hype_detected: boolean;
  sources: {
    dexscreener: boolean; pumpfun: boolean; lunarcrush: boolean;
    twitter: boolean; telegram: boolean; helius_blocks: boolean; ai_sentiment: boolean;
  };
  // DexScreener
  tx_count_m5: number;
  tx_count_h1: number;
  tx_count_h6: number;
  price_change_h1: number;
  market_cap: number | null;
  fdv: number | null;
  volume_m5: number;
  volume_h1: number;
  volume_h24: number;
  has_paid_boost: boolean;
  // V_pressure fields expose estimated buy/sell imbalance.
  v_pressure: number;
  buy_volume_m5: number;
  sell_volume_m5: number;
  buy_volume_m15: number;
  sell_volume_m15: number;
  buy_volume_h1: number;
  sell_volume_h1: number;
  // Liquidity fields expose pool depth, quote slippage, and flash-crash risk.
  liquidity_ratio: number;
  liquidity_to_mcap_ratio: number | null;
  quote_slippage_bps_small: number | null;
  quote_slippage_bps_medium: number | null;
  quote_slippage_bps_large: number | null;
  quote_slippage_risk: number;
  is_flash_crash_risk: boolean;
  liquidity_usd: number;
  // Pump.fun
  pump_reply_count: number;
  pump_is_graduated: boolean;
  pump_king_of_hill: boolean;
  // CoinGecko sentiment
  galaxy_score: number | null;
  social_volume: number | null;
  // Sentiment shift fields compare current sentiment against the previous scan.
  sentiment_shift: number;
  sentiment_prev: number | null;
  sentiment_label: 'STABLE' | 'IMPROVING' | 'DECLINING' | 'CRASH';
  is_sentiment_crash: boolean;
  // Pillar 1: Real tweet velocity
  tweet_growth_rate: number | null;
  tweet_unique_users: number | null;
  tweet_bot_ratio: number | null;
  tweet_is_bot_pump: boolean;
  // KOL fields report deduplicated influential accounts and their combined reach.
  kol_count: number;
  kol_names: string[];
  is_organized_shill: boolean;
  weighted_shill_reach: number;
  shill_size: 'NONE' | 'MICRO' | 'MID' | 'MEGA';
  // Engagement fields track whether recent tweet interactions are fading.
  avg_engagement_per_tweet: number;
  engagement_decay_pct: number;
  is_engagement_dying: boolean;
  // Twitter-native Sentiment (real-time, keyword-weighted)
  twitter_sentiment_score: number;        // 0-100 (50=neutral, <35=fear)
  is_twitter_sentiment_negative: boolean;
  // Telegram fields report group membership velocity and churn.
  tg_group: string | null;
  tg_member_count: number | null;
  tg_member_growth_rate: number | null;
  tg_member_delta: number | null;
  is_tg_surging: boolean;
  is_tg_declining: boolean;
  // Block-density fields report same-slot bursts and buy-heavy block streaks.
  block_density_pct: number | null;
  blocks_with_swaps: number | null;
  consecutive_buy_blocks: number | null;
  max_swaps_in_slot: number | null;
  burst_slot_count: number | null;
  same_slot_bundle_detected: boolean;
  is_god_candle: boolean;
  // AI sentiment fields report LLM interpretation of top tweets.
  ai_sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED' | null;
  ai_confidence: number | null;
  ai_summary: string | null;
  ai_sarcasm_detected: boolean;
  ai_key_concerns: string[];
  ai_dominant_narrative: string | null;
  // Flags
  flags: VelocityFlag[];
  // Legacy compatibility
  tweet_velocity: { growth_rate: number; unique_user_rate: number; bot_ratio: number };
  holder_momentum: { growth_rate: number; is_declining: boolean };
  // Instant charts
  tweet_timeline: { time: string; count: number }[];
  dex_buy_timeline: { time: string; buys: number; sells: number }[];
  snapshots: { tweets: any[]; holders: any[] };
}
