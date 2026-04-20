/**
 * FocusAggregator
 *
 * Aggregates on-device engagement telemetry into an abstract attention-depth
 * score. Raw telemetry samples are never retained after aggregation.
 */

export type AttentionDepth = "fragmented" | "steady" | "deep";

export interface FocusSignal {
  scrollPauseMs: number;
  interactionCount: number;
  sampleWindowMs?: number;
}

export interface FocusSnapshot {
  attentionDepthScore: number;
  attentionDepth: AttentionDepth;
  confidence: number;
  samplesProcessed: number;
  computedAt: string;
}

const DEFAULT_WINDOW_MS = 5_000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(value: number, knee: number): number {
  if (value <= 0) return 0;
  return value / (value + knee);
}

function classifyAttentionDepth(score: number): AttentionDepth {
  if (score < 0.4) return "fragmented";
  if (score < 0.7) return "steady";
  return "deep";
}

export class FocusAggregator {
  private pauseEma = 0.5;
  private interactionEma = 0.5;
  private volatilityEma = 0.3;
  private samples = 0;
  private lastScore = 0.5;

  ingest(signal: FocusSignal): FocusSnapshot {
    const windowMs = signal.sampleWindowMs ?? DEFAULT_WINDOW_MS;
    const pauseScore = clamp(sigmoid(signal.scrollPauseMs, 2_200), 0, 1);
    const interactionsPerMinute = windowMs > 0
      ? signal.interactionCount * (60_000 / windowMs)
      : 0;
    const interactionScore = clamp(interactionsPerMinute / 18, 0, 1);

    this.samples += 1;
    const smoothing = this.samples < 8 ? 0.35 : 0.2;
    this.pauseEma = this.pauseEma + (pauseScore - this.pauseEma) * smoothing;
    this.interactionEma = this.interactionEma + (interactionScore - this.interactionEma) * smoothing;

    const score = clamp(0.58 * this.pauseEma + 0.42 * this.interactionEma, 0, 1);
    const delta = Math.abs(score - this.lastScore);
    this.volatilityEma = this.volatilityEma + (delta - this.volatilityEma) * 0.25;
    this.lastScore = score;

    const confidence = clamp(
      Math.min(0.98, 0.35 + this.samples * 0.08) * (1 - this.volatilityEma * 0.7),
      0.2,
      0.98
    );

    return {
      attentionDepthScore: score,
      attentionDepth: classifyAttentionDepth(score),
      confidence,
      samplesProcessed: this.samples,
      computedAt: new Date().toISOString()
    };
  }

  snapshotFromAttentionScore(attentionScore: number): FocusSnapshot {
    const score = clamp(attentionScore, 0, 1);
    return {
      attentionDepthScore: score,
      attentionDepth: classifyAttentionDepth(score),
      confidence: 0.45,
      samplesProcessed: this.samples,
      computedAt: new Date().toISOString()
    };
  }
}

export const focusAggregator = new FocusAggregator();
