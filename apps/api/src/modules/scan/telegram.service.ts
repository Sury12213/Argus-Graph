import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken: string;
  private readonly defaultChatId: string | undefined;
  private readonly enabled: boolean;

  constructor(
    private http: HttpService,
    private config: ConfigService,
  ) {
    this.botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
    this.defaultChatId = this.config.get<string>('TELEGRAM_CHAT_ID');
    this.enabled = !!this.botToken;
    if (this.enabled) {
      this.logger.log('Telegram alerts enabled');
      if (!this.defaultChatId) {
        this.logger.warn('TELEGRAM_CHAT_ID missing — default alerts disabled, per-user alerts still available');
      }
    } else {
      this.logger.warn('Telegram alerts disabled — set TELEGRAM_BOT_TOKEN');
    }
  }

  async sendAlert(message: string, chatId?: string): Promise<void> {
    if (!this.enabled) return;
    const targetChatId = chatId ?? this.defaultChatId;
    if (!targetChatId) {
      this.logger.warn('[TELEGRAM] No chat id available for alert');
      return;
    }
    await this.sendMessage(targetChatId, message);
  }

  async sendScanAlert(params: ScanAlertParams): Promise<void> {
    if (!this.enabled) return;

    const targetChatId = params.chatId ?? this.defaultChatId;
    if (!targetChatId) {
      this.logger.warn('[TELEGRAM] No chat id available for scan alert');
      return;
    }

    const { token, scores, triggers, decision } = params;
    const riskLabel =
      scores.final >= 75 ? 'CRITICAL' :
      scores.final >= 50 ? 'HIGH' :
      scores.final >= 30 ? 'MEDIUM' : 'LOW';

    const displayToken = this.escapeHtml(token.symbol ?? `${token.address.slice(0, 8)}...`);
    const triggerLines = triggers.map((trigger) => `- ${this.escapeHtml(trigger)}`).join('\n');

    const message = [
      `<b>Argus Alert [${riskLabel}] - ${displayToken}</b>`,
      '',
      `<b>Risk score:</b> <code>${this.formatScore(scores.final)}</code> / 100 (${this.escapeHtml(scores.risk_level)})`,
      `<b>Decision:</b> ${this.escapeHtml(decision)}`,
      '',
      '<b>Score breakdown</b>',
      `Cluster: <code>${this.formatScore(scores.cluster_risk)}</code>`,
      `Smart money: <code>${this.formatScore(scores.smart_money)}</code>`,
      `Velocity: <code>${this.formatScore(scores.velocity_score)}</code>`,
      `On-chain: <code>${this.formatScore(scores.basic_onchain)}</code>`,
      '',
      triggers.length > 0 ? `<b>Signals detected</b>\n${triggerLines}` : '',
      '',
      `<b>Token:</b> <code>${this.escapeHtml(token.address)}</code>`,
    ].filter(Boolean).join('\n');

    await this.sendMessage(targetChatId, message);
  }

  buildTriggers(scanResult: any): string[] {
    const triggers: string[] = [];
    const engines = scanResult.engines ?? {};
    const scores = scanResult.scores ?? {};

    if ((engines.cluster?.funding_clusters ?? 0) > 0) {
      triggers.push(`${engines.cluster.funding_clusters} funding cluster(s) detected — wallets share the same funding source.`);
    }

    const criticalClusters = (engines.cluster?.clusters ?? []).filter(
      (c: any) => c.risk_level === 'CRITICAL',
    );
    if (criticalClusters.length > 0) {
      triggers.push(
        `${criticalClusters[0].member_count} wallets in cluster ${criticalClusters[0].cluster_id} — high bundle risk.`,
      );
    }

    if (engines.smart_money?.dev_dump_detected) {
      triggers.push('Dev wallet is selling — elevated rug-pull risk.');
    }

    if (engines.smart_money?.stealth_accumulation) {
      triggers.push(`${engines.smart_money.coordinated_wallets} similarly sized wallets detected — possible wallet farm.`);
    }

    const botPump = (engines.velocity?.flags ?? []).find((f: any) => f.type === 'BOT_PUMP');
    if (botPump) {
      triggers.push(botPump.description);
    }

    return triggers;
  }

  shouldSendScanAlert(params: ScanAlertParams): boolean {
    return params.decision === 'BLOCKED' || params.scores.final >= 75 || params.triggers.length > 0;
  }

  private formatScore(value: number | null): string {
    return typeof value === 'number' ? value.toFixed(1) : 'n/a';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      await firstValueFrom(
        this.http.post(url, {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      );
      this.logger.debug(`[TELEGRAM] Sent alert to ${chatId}`);
    } catch (err: any) {
      this.logger.error(`[TELEGRAM] Failed: ${err.message}`);
    }
  }
}

export interface ScanAlertParams {
  token: { address: string; symbol?: string };
  scores: {
    final: number;
    risk_level: string;
    cluster_risk: number | null;
    smart_money: number | null;
    velocity_score: number | null;
    basic_onchain: number;
  };
  decision: string;
  triggers: string[];
  chatId?: string;
}
