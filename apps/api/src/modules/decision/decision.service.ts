import { Injectable } from '@nestjs/common';

/**
 * Decision Layer — Compares score vs user rules.
 *
 * Pure function, no AI. Deterministic logic only.
 * Maps finalScore against user's maxRiskScore threshold.
 */
@Injectable()
export class DecisionService {
  decide(finalScore: number, userSettings: UserRiskSettings): DecisionResult {
    const { maxRiskScore, autoExitEnabled } = userSettings;

    let decision: 'APPROVED' | 'BLOCKED' | 'WARNING';
    let reason: string;

    if (finalScore > maxRiskScore) {
      decision = 'BLOCKED';
      reason = `Risk score (${finalScore.toFixed(1)}) exceeds your maximum threshold (${maxRiskScore}). Transaction blocked.`;
    } else if (finalScore > maxRiskScore * 0.8) {
      decision = 'WARNING';
      reason = `Risk score (${finalScore.toFixed(1)}) is approaching your threshold (${maxRiskScore}). Proceed with caution.`;
    } else {
      decision = 'APPROVED';
      reason = `Risk score (${finalScore.toFixed(1)}) is within your acceptable range (max: ${maxRiskScore}).`;
    }

    return {
      decision,
      reason,
      final_score: finalScore,
      user_max_risk: maxRiskScore,
      auto_exit_enabled: autoExitEnabled,
    };
  }
}

export interface UserRiskSettings {
  maxRiskScore: number;
  autoExitEnabled: boolean;
  slippageBps: number;
}

export interface DecisionResult {
  decision: 'APPROVED' | 'BLOCKED' | 'WARNING';
  reason: string;
  final_score: number;
  user_max_risk: number;
  auto_exit_enabled: boolean;
}
