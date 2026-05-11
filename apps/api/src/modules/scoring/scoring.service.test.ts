import { describe, expect, it } from 'vitest';
import { ScoringInput, ScoringService, TraderAction } from './scoring.service';

interface CalibrationCase {
  name: string;
  input: ScoringInput;
  expectedAction: TraderAction;
  maxRisk?: number;
  minRisk?: number;
  minOpportunity?: number;
}

const baseInput: ScoringInput = {
  cluster_risk: 35,
  velocity_score: 35,
  smart_money: 35,
  basic_onchain: 25,
  market_mode: 'NORMAL',
  risk_context: {
    price_change_h1: 20,
    lp_locked: true,
    lp_lock_confidence: 'verified',
    mint_authority_revoked: true,
    freeze_authority_revoked: true,
    rugcheck_critical_count: 0,
    dev_dump_detected: false,
  },
  degen_signals: { hype_detected: false },
  velocity_context: {
    hype_detected: false,
    tweet_is_bot_pump: false,
    liquidity_ratio: 1.2,
    liquidity_usd: 250_000,
    liquidity_to_mcap_ratio: 0.08,
    quote_slippage_risk: 20,
    has_paid_boost: false,
    same_slot_bundle_detected: false,
    buy_volume_m5: 30_000,
    sell_volume_m5: 18_000,
    buy_volume_m15: 90_000,
    sell_volume_m15: 55_000,
    buy_volume_h1: 250_000,
    sell_volume_h1: 160_000,
    twitter_sentiment_score: 62,
    ai_sentiment: 'NEUTRAL',
  },
  smart_money_context: {
    net_flow_direction: 'NEUTRAL',
    alpha_wallet_accumulating_score: 20,
    alpha_wallet_selling_score: 10,
  },
};

const withInput = (patch: Partial<ScoringInput>): ScoringInput => ({
  ...baseInput,
  ...patch,
  risk_context: { ...baseInput.risk_context, ...patch.risk_context },
  velocity_context: { ...baseInput.velocity_context, ...patch.velocity_context },
  smart_money_context: { ...baseInput.smart_money_context, ...patch.smart_money_context },
});

const cases: CalibrationCase[] = [
  {
    name: 'hard rug with unlocked LP and active freeze is avoided',
    expectedAction: 'AVOID',
    minRisk: 80,
    input: withInput({
      cluster_risk: 75,
      velocity_score: 80,
      smart_money: 85,
      basic_onchain: 92,
      risk_context: {
        lp_locked: false,
        mint_authority_revoked: false,
        freeze_authority_revoked: false,
        rugcheck_critical_count: 1,
      },
    }),
  },
  {
    name: 'thin liquidity runner allows only tiny size',
    expectedAction: 'AVOID_OR_TINY_SIZE',
    minRisk: 55,
    input: withInput({
      basic_onchain: 25,
      velocity_context: {
        liquidity_usd: 4_000,
        liquidity_to_mcap_ratio: 0.008,
        quote_slippage_risk: 90,
        hype_detected: true,
        twitter_sentiment_score: 76,
      },
      degen_signals: { hype_detected: true },
      smart_money_context: {
        net_flow_direction: 'ACCUMULATING',
        alpha_wallet_accumulating_score: 90,
      },
    }),
  },
  {
    name: 'smart money distribution triggers exit or avoid',
    expectedAction: 'EXIT_OR_AVOID',
    minRisk: 55,
    input: withInput({
      smart_money: 78,
      risk_context: {
        dev_dump_detected: true,
      },
      smart_money_context: {
        net_flow_direction: 'DISTRIBUTING',
        alpha_wallet_selling_score: 80,
      },
    }),
  },
  {
    name: 'organic runner with clean structure is ok',
    expectedAction: 'OK',
    maxRisk: 45,
    minOpportunity: 60,
    input: withInput({
      cluster_risk: 20,
      velocity_score: 25,
      smart_money: 20,
      basic_onchain: 15,
      velocity_context: {
        hype_detected: true,
        liquidity_usd: 800_000,
        liquidity_to_mcap_ratio: 0.12,
        quote_slippage_risk: 10,
        twitter_sentiment_score: 78,
        ai_sentiment: 'BULLISH',
      },
      degen_signals: { hype_detected: true },
      smart_money_context: {
        net_flow_direction: 'ACCUMULATING',
        alpha_wallet_accumulating_score: 100,
      },
    }),
  },
  {
    name: 'late entry pump is watch or scalp only',
    expectedAction: 'WATCH_OR_SCALP',
    minRisk: 50,
    input: withInput({
      cluster_risk: 35,
      velocity_score: 70,
      smart_money: 35,
      basic_onchain: 20,
      risk_context: {
        price_change_h1: 180,
      },
      velocity_context: {
        hype_detected: true,
        liquidity_usd: 180_000,
        twitter_sentiment_score: 72,
      },
      degen_signals: { hype_detected: true },
    }),
  },
  {
    name: 'pump.fun pre-migration does not over-penalize unknown DEX LP',
    expectedAction: 'OK',
    maxRisk: 45,
    input: withInput({
      cluster_risk: 20,
      velocity_score: 25,
      smart_money: 20,
      basic_onchain: 15,
      risk_context: {
        lp_locked: null,
        lp_lock_confidence: 'unknown',
        is_pumpfun_token: true,
        pump_is_graduated: false,
        dex_pool_count: 0,
      },
      velocity_context: {
        hype_detected: true,
        liquidity_usd: 600_000,
        twitter_sentiment_score: 76,
        ai_sentiment: 'BULLISH',
      },
      degen_signals: { hype_detected: true },
      smart_money_context: {
        net_flow_direction: 'ACCUMULATING',
        alpha_wallet_accumulating_score: 100,
      },
    }),
  },
];

describe('ScoringService trader calibration', () => {
  const service = new ScoringService();

  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = service.calculateTraderScore(testCase.input);

      expect(result.action).toBe(testCase.expectedAction);
      if (testCase.minRisk != null) expect(result.risk_score).toBeGreaterThanOrEqual(testCase.minRisk);
      if (testCase.maxRisk != null) expect(result.risk_score).toBeLessThan(testCase.maxRisk);
      if (testCase.minOpportunity != null) expect(result.opportunity_score).toBeGreaterThanOrEqual(testCase.minOpportunity);
    });
  }

  it('caps OK action when scoring confidence is low', () => {
    const result = service.calculateTraderScore(withInput({
      cluster_risk: null,
      velocity_score: null,
      smart_money: null,
      confidence: 0.2,
      velocity_context: {
        hype_detected: true,
        twitter_sentiment_score: 90,
        ai_sentiment: 'BULLISH',
      },
      smart_money_context: {
        net_flow_direction: 'ACCUMULATING',
        alpha_wallet_accumulating_score: 100,
      },
    }));

    expect(result.action).toBe('AVOID');
    expect(result.raw_action).toBe('OK');
    expect(result.warnings).toContain('LOW_CONFIDENCE_ACTION_CAPPED');
    expect(result.warnings).toContain('ACTION_CAPPED_FROM_OK');
  });
});
