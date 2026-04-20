/**
 * ArbitrageEngine.ts
 * High-Frequency Arbitrage Engine for matching ad formats to highest yielding bids.
 * Uses financial optimization algorithms to maximize yield based on real-time user pulse data.
 */

import { AggregatedBid } from "./BidAggregator";

export type AdFormat = "micro-burst" | "narrative-longform" | "banner" | "native" | "interstitial";
export type UserAttentionState = "fragmented" | "steady" | "deep";

export interface UserPulseData {
  userId: string;
  attentionState: UserAttentionState;
  attentionScore: number;
  sessionDurationMs: number;
  recentInteractionCount: number;
  scrollVelocity: number;
  deviceType: "mobile" | "tablet" | "desktop";
  timestamp: number;
}

export interface ArbitrageMatch {
  slotId: string;
  userId: string;
  selectedBid: AggregatedBid;
  recommendedFormat: AdFormat;
  expectedYield: number;
  yieldMultiplier: number;
  attentionAlignment: number;
  arbitrageScore: number;
  executionLatencyMs: number;
  reasoning: string[];
}

export interface ArbitrageMetrics {
  totalMatches: number;
  totalYield: number;
  avgExecutionLatencyMs: number;
  formatDistribution: Record<AdFormat, number>;
  attentionStateDistribution: Record<UserAttentionState, number>;
  yieldByFormat: Record<AdFormat, number>;
}

export class ArbitrageEngine {
  private matchHistory: ArbitrageMatch[] = [];
  private readonly maxHistorySize: number = 10000;

  executeArbitrage(
    slotId: string,
    bids: AggregatedBid[],
    userPulse: UserPulseData
  ): ArbitrageMatch | null {
    const startTime = Date.now();

    if (bids.length === 0) {
      return null;
    }

    const formatScores = this.computeFormatScores(userPulse);
    const bestMatch = this.findOptimalMatch(slotId, bids, userPulse, formatScores);

    if (!bestMatch) {
      return null;
    }

    const executionLatencyMs = Date.now() - startTime;
    const match: ArbitrageMatch = {
      ...bestMatch,
      executionLatencyMs
    };

    this.recordMatch(match);
    return match;
  }

  getMetrics(): ArbitrageMetrics {
    if (this.matchHistory.length === 0) {
      return this.getEmptyMetrics();
    }

    const totalMatches = this.matchHistory.length;
    const totalYield = this.matchHistory.reduce((sum, m) => sum + m.expectedYield, 0);
    const avgExecutionLatencyMs = this.matchHistory.reduce((sum, m) => sum + m.executionLatencyMs, 0) / totalMatches;

    const formatDistribution: Record<string, number> = {};
    const attentionStateDistribution: Record<string, number> = {};
    const yieldByFormat: Record<string, number> = {};

    for (const match of this.matchHistory) {
      const format = match.recommendedFormat;
      const state = this.deriveAttentionState(match);

      formatDistribution[format] = (formatDistribution[format] || 0) + 1;
      attentionStateDistribution[state] = (attentionStateDistribution[state] || 0) + 1;
      yieldByFormat[format] = (yieldByFormat[format] || 0) + match.expectedYield;
    }

    return {
      totalMatches,
      totalYield: Number(totalYield.toFixed(2)),
      avgExecutionLatencyMs: Number(avgExecutionLatencyMs.toFixed(4)),
      formatDistribution: formatDistribution as Record<AdFormat, number>,
      attentionStateDistribution: attentionStateDistribution as Record<UserAttentionState, number>,
      yieldByFormat: yieldByFormat as Record<AdFormat, number>
    };
  }

  clearHistory(): void {
    this.matchHistory = [];
  }

  private findOptimalMatch(
    slotId: string,
    bids: AggregatedBid[],
    userPulse: UserPulseData,
    formatScores: Record<AdFormat, number>
  ): Omit<ArbitrageMatch, "executionLatencyMs"> | null {
    let bestScore = -Infinity;
    let bestMatch: Omit<ArbitrageMatch, "executionLatencyMs"> | null = null;

    for (const bid of bids) {
      const format = this.mapCreativeToFormat(bid.creativeFormat, userPulse.attentionState);
      const formatScore = formatScores[format] || 0;
      const attentionAlignment = this.calculateAttentionAlignment(bid, userPulse);
      const yieldMultiplier = this.calculateYieldMultiplier(formatScore, attentionAlignment, userPulse);
      const expectedYield = bid.effectiveCpm * yieldMultiplier;
      const arbitrageScore = this.calculateArbitrageScore(expectedYield, attentionAlignment, formatScore, bid);

      if (arbitrageScore > bestScore) {
        bestScore = arbitrageScore;
        bestMatch = {
          slotId,
          userId: userPulse.userId,
          selectedBid: bid,
          recommendedFormat: format,
          expectedYield: Number(expectedYield.toFixed(4)),
          yieldMultiplier: Number(yieldMultiplier.toFixed(4)),
          attentionAlignment: Number(attentionAlignment.toFixed(4)),
          arbitrageScore: Number(arbitrageScore.toFixed(4)),
          reasoning: this.buildReasoning(bid, format, userPulse, formatScore, attentionAlignment, yieldMultiplier)
        };
      }
    }

    return bestMatch;
  }

  private computeFormatScores(userPulse: UserPulseData): Record<AdFormat, number> {
    const { attentionState, attentionScore, deviceType, scrollVelocity } = userPulse;

    const deviceMultiplier = deviceType === "desktop" ? 1.2 : deviceType === "tablet" ? 1.0 : 0.85;
    const scrollPenalty = this.clamp(1 - scrollVelocity / 1000, 0.6, 1.0);

    const scores: Record<AdFormat, number> = {
      "micro-burst": 0,
      "narrative-longform": 0,
      banner: 0,
      native: 0,
      interstitial: 0
    };

    if (attentionState === "fragmented") {
      scores["micro-burst"] = 0.95 * scrollPenalty;
      scores.banner = 0.75 * scrollPenalty;
      scores.native = 0.65;
      scores.interstitial = 0.4;
      scores["narrative-longform"] = 0.3;
    } else if (attentionState === "steady") {
      scores["micro-burst"] = 0.6;
      scores.banner = 0.8 * scrollPenalty;
      scores.native = 0.9 * deviceMultiplier;
      scores.interstitial = 0.75;
      scores["narrative-longform"] = 0.7;
    } else {
      scores["micro-burst"] = 0.4;
      scores.banner = 0.6;
      scores.native = 0.85 * deviceMultiplier;
      scores.interstitial = 0.9 * deviceMultiplier;
      scores["narrative-longform"] = 1.0 * deviceMultiplier;
    }

    const attentionBoost = attentionScore * 0.2;
    for (const format in scores) {
      scores[format as AdFormat] = this.clamp(scores[format as AdFormat] + attentionBoost, 0, 1);
    }

    return scores;
  }

  private calculateAttentionAlignment(bid: AggregatedBid, userPulse: UserPulseData): number {
    const bidAttention = bid.attentionScore;
    const userAttention = userPulse.attentionScore;
    const alignmentDelta = Math.abs(bidAttention - userAttention);
    const alignment = this.clamp(1 - alignmentDelta, 0, 1);
    return alignment;
  }

  private calculateYieldMultiplier(
    formatScore: number,
    attentionAlignment: number,
    userPulse: UserPulseData
  ): number {
    const baseMultiplier = 1.0;
    const formatContribution = formatScore * 0.4;
    const attentionContribution = attentionAlignment * 0.35;
    const sessionContribution = this.clamp(userPulse.sessionDurationMs / 60000, 0, 0.25);

    return baseMultiplier + formatContribution + attentionContribution + sessionContribution;
  }

  private calculateArbitrageScore(
    expectedYield: number,
    attentionAlignment: number,
    formatScore: number,
    bid: AggregatedBid
  ): number {
    const yieldComponent = expectedYield * 0.5;
    const alignmentComponent = attentionAlignment * bid.effectiveCpm * 0.3;
    const formatComponent = formatScore * bid.effectiveCpm * 0.2;

    return yieldComponent + alignmentComponent + formatComponent;
  }

  private mapCreativeToFormat(
    creativeFormat: AggregatedBid["creativeFormat"],
    attentionState: UserAttentionState
  ): AdFormat {
    if (creativeFormat === "video") {
      return attentionState === "fragmented" ? "micro-burst" : "narrative-longform";
    }

    const formatMap: Record<AggregatedBid["creativeFormat"], AdFormat> = {
      banner: "banner",
      native: "native",
      interstitial: "interstitial",
      video: "narrative-longform"
    };

    return formatMap[creativeFormat];
  }

  private buildReasoning(
    bid: AggregatedBid,
    format: AdFormat,
    userPulse: UserPulseData,
    formatScore: number,
    attentionAlignment: number,
    yieldMultiplier: number
  ): string[] {
    return [
      `Selected bid ${bid.bidId} from DSP ${bid.dspId} with effective CPM $${bid.effectiveCpm.toFixed(2)}.`,
      `User attention state: ${userPulse.attentionState} (score ${userPulse.attentionScore.toFixed(2)}).`,
      `Recommended format: ${format} (format score ${formatScore.toFixed(2)}).`,
      `Attention alignment: ${attentionAlignment.toFixed(2)} (bid ${bid.attentionScore.toFixed(2)} vs user ${userPulse.attentionScore.toFixed(2)}).`,
      `Yield multiplier: ${yieldMultiplier.toFixed(2)}x resulting in expected yield $${(bid.effectiveCpm * yieldMultiplier).toFixed(4)}.`,
      `Device ${userPulse.deviceType}, session ${(userPulse.sessionDurationMs / 1000).toFixed(0)}s, interactions ${userPulse.recentInteractionCount}.`
    ];
  }

  private recordMatch(match: ArbitrageMatch): void {
    this.matchHistory.push(match);

    if (this.matchHistory.length > this.maxHistorySize) {
      this.matchHistory = this.matchHistory.slice(-this.maxHistorySize);
    }
  }

  private deriveAttentionState(match: ArbitrageMatch): UserAttentionState {
    const score = match.selectedBid.attentionScore;
    if (score < 0.4) return "fragmented";
    if (score < 0.7) return "steady";
    return "deep";
  }

  private getEmptyMetrics(): ArbitrageMetrics {
    return {
      totalMatches: 0,
      totalYield: 0,
      avgExecutionLatencyMs: 0,
      formatDistribution: {
        "micro-burst": 0,
        "narrative-longform": 0,
        banner: 0,
        native: 0,
        interstitial: 0
      },
      attentionStateDistribution: {
        fragmented: 0,
        steady: 0,
        deep: 0
      },
      yieldByFormat: {
        "micro-burst": 0,
        "narrative-longform": 0,
        banner: 0,
        native: 0,
        interstitial: 0
      }
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}
