import { Injectable } from '@nestjs/common';

/**
 * ⚙️ Scoring Engine — DETERMINISTIC (No AI)
 *
 * Pure utility class implementing the weighted scoring formula.
 * This is the single source of truth for risk calculation.
 *
 * Formula:
 *   Final_Score = (0.3 × Cluster_Risk) + (0.3 × Velocity_Score)
 *                + (0.2 × Smart_Money) + (0.2 × Basic_Onchain)
 *
 * All inputs and outputs are 0-100 scale.
 * Higher score = Higher risk.
 */
@Injectable()
export class ScoringService {
  // Weights — easy to adjust without touching logic
  private static readonly WEIGHTS = {
    cluster_risk: 0.3,
    velocity_score: 0.3,
    smart_money: 0.2,
    basic_onchain: 0.2,
  } as const;

  /**
   * Calculate the unified risk score from all engine outputs.
   * Pure function — no side effects, no AI, deterministic.
   */
  calculateFinalScore(input: ScoringInput): ScoringResult {
    const { cluster_risk, velocity_score, smart_money, basic_onchain } = input;
    const w = ScoringService.WEIGHTS;

    const finalScore =
      w.cluster_risk * cluster_risk +
      w.velocity_score * velocity_score +
      w.smart_money * smart_money +
      w.basic_onchain * basic_onchain;

    const clamped = Math.min(100, Math.max(0, Math.round(finalScore * 10) / 10));

    return {
      final_score: clamped,
      risk_level: this.getRiskLevel(clamped),
      breakdown: {
        cluster_risk: { score: cluster_risk, weight: w.cluster_risk, contribution: cluster_risk * w.cluster_risk },
        velocity_score: { score: velocity_score, weight: w.velocity_score, contribution: velocity_score * w.velocity_score },
        smart_money: { score: smart_money, weight: w.smart_money, contribution: smart_money * w.smart_money },
        basic_onchain: { score: basic_onchain, weight: w.basic_onchain, contribution: basic_onchain * w.basic_onchain },
      },
      weights: { ...w },
    };
  }

  /**
   * Get human-readable risk level from score.
   */
  private getRiskLevel(score: number): RiskLevel {
    if (score >= 75) return 'CRITICAL';
    if (score >= 50) return 'HIGH';
    if (score >= 30) return 'MEDIUM';
    return 'LOW';
  }
}

// ── Types ──

export interface ScoringInput {
  cluster_risk: number;
  velocity_score: number;
  smart_money: number;
  basic_onchain: number;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ScoringResult {
  final_score: number;
  risk_level: RiskLevel;
  breakdown: Record<string, { score: number; weight: number; contribution: number }>;
  weights: Record<string, number>;
}
