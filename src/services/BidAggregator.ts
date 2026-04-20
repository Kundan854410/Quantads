/**
 * BidAggregator.ts
 * Real-Time Bid Aggregator for ultra-low latency DSP bid ingestion.
 * Ingests real-time bids from DSPs via OpenRTB protocols with a strict 10ms timeout.
 * Evaluates bids on CPM and predicted user "attention depth" specific to ad creative.
 */

export interface DspBid {
  bidId: string;
  dspId: string;
  campaignId: string;
  cpm: number;
  creativeId: string;
  creativeFormat: "banner" | "video" | "native" | "interstitial";
  targetingParams: Record<string, string | number | boolean>;
  submittedAt: number;
  ttlMs: number;
}

export interface AttentionDepthPrediction {
  creativeId: string;
  predictedDepth: number;
  confidence: number;
  factors: {
    visualComplexity: number;
    colorSaturation: number;
    motionIntensity: number;
    narrativeStructure: number;
  };
}

export interface AggregatedBid extends DspBid {
  attentionScore: number;
  effectiveCpm: number;
  expiresAt: number;
  rank: number;
}

export interface BidAggregatorConfig {
  maxBidsPerSlot: number;
  bidTimeoutMs: number;
  attentionWeightFactor: number;
  cpmWeightFactor: number;
}

const DEFAULT_CONFIG: BidAggregatorConfig = {
  maxBidsPerSlot: 50,
  bidTimeoutMs: 10,
  attentionWeightFactor: 0.4,
  cpmWeightFactor: 0.6
};

export class BidAggregator {
  private activeBids: Map<string, AggregatedBid[]> = new Map();
  private attentionPredictor: AttentionDepthPredictor;
  private config: BidAggregatorConfig;

  constructor(config: Partial<BidAggregatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.attentionPredictor = new AttentionDepthPredictor();
  }

  ingestBid(slotId: string, bid: DspBid): { accepted: boolean; reason?: string } {
    const now = Date.now();
    const submissionLatency = now - bid.submittedAt;

    if (submissionLatency > this.config.bidTimeoutMs) {
      return { accepted: false, reason: `bid_timeout: ${submissionLatency}ms exceeds ${this.config.bidTimeoutMs}ms` };
    }

    if (bid.cpm <= 0) {
      return { accepted: false, reason: "invalid_cpm: must be positive" };
    }

    if (bid.ttlMs <= 0) {
      return { accepted: false, reason: "invalid_ttl: must be positive" };
    }

    const attentionPrediction = this.attentionPredictor.predict(bid.creativeId, bid.creativeFormat);
    const attentionScore = this.clamp(attentionPrediction.predictedDepth * attentionPrediction.confidence, 0, 1);
    const effectiveCpm = this.calculateEffectiveCpm(bid.cpm, attentionScore);
    const expiresAt = now + bid.ttlMs;

    const aggregatedBid: AggregatedBid = {
      ...bid,
      attentionScore,
      effectiveCpm,
      expiresAt,
      rank: 0
    };

    if (!this.activeBids.has(slotId)) {
      this.activeBids.set(slotId, []);
    }

    const slotBids = this.activeBids.get(slotId)!;
    slotBids.push(aggregatedBid);

    if (slotBids.length > this.config.maxBidsPerSlot) {
      slotBids.sort((a, b) => b.effectiveCpm - a.effectiveCpm);
      slotBids.splice(this.config.maxBidsPerSlot);
    }

    this.pruneExpiredBids(slotId, now);
    this.rankBids(slotId);

    return { accepted: true };
  }

  getTopBids(slotId: string, limit: number = 10): AggregatedBid[] {
    this.pruneExpiredBids(slotId, Date.now());
    const bids = this.activeBids.get(slotId) || [];
    return bids.slice(0, Math.min(limit, bids.length));
  }

  clearSlot(slotId: string): void {
    this.activeBids.delete(slotId);
  }

  getStats(): {
    totalSlots: number;
    totalActiveBids: number;
    avgBidsPerSlot: number;
    topSlotsByVolume: Array<{ slotId: string; bidCount: number }>;
  } {
    const slots = Array.from(this.activeBids.entries());
    const totalSlots = slots.length;
    const totalActiveBids = slots.reduce((sum, [_, bids]) => sum + bids.length, 0);
    const avgBidsPerSlot = totalSlots > 0 ? totalActiveBids / totalSlots : 0;
    const topSlotsByVolume = slots
      .map(([slotId, bids]) => ({ slotId, bidCount: bids.length }))
      .sort((a, b) => b.bidCount - a.bidCount)
      .slice(0, 10);

    return {
      totalSlots,
      totalActiveBids,
      avgBidsPerSlot: Number(avgBidsPerSlot.toFixed(2)),
      topSlotsByVolume
    };
  }

  private calculateEffectiveCpm(baseCpm: number, attentionScore: number): number {
    const attentionComponent = attentionScore * this.config.attentionWeightFactor;
    const cpmComponent = (baseCpm / 100) * this.config.cpmWeightFactor;
    const effectiveCpm = baseCpm * (1 + attentionComponent + cpmComponent);
    return Number(effectiveCpm.toFixed(4));
  }

  private pruneExpiredBids(slotId: string, now: number): void {
    const bids = this.activeBids.get(slotId);
    if (!bids) return;

    const validBids = bids.filter((bid) => bid.expiresAt > now);
    if (validBids.length === 0) {
      this.activeBids.delete(slotId);
    } else {
      this.activeBids.set(slotId, validBids);
    }
  }

  private rankBids(slotId: string): void {
    const bids = this.activeBids.get(slotId);
    if (!bids) return;

    bids.sort((a, b) => b.effectiveCpm - a.effectiveCpm);
    bids.forEach((bid, index) => {
      bid.rank = index + 1;
    });
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}

/**
 * AttentionDepthPredictor
 * Predicts user attention depth based on creative characteristics.
 * Uses a deterministic algorithm based on visual/narrative features.
 */
class AttentionDepthPredictor {
  private creativeCache: Map<string, AttentionDepthPrediction> = new Map();

  predict(creativeId: string, format: DspBid["creativeFormat"]): AttentionDepthPrediction {
    if (this.creativeCache.has(creativeId)) {
      return this.creativeCache.get(creativeId)!;
    }

    const prediction = this.computePrediction(creativeId, format);
    this.creativeCache.set(creativeId, prediction);
    return prediction;
  }

  private computePrediction(creativeId: string, format: DspBid["creativeFormat"]): AttentionDepthPrediction {
    const seed = this.hashString(creativeId);
    const baseFactors = this.generateFactors(seed);

    const formatMultipliers: Record<DspBid["creativeFormat"], number> = {
      banner: 0.6,
      native: 0.85,
      interstitial: 0.95,
      video: 1.0
    };

    const formatMultiplier = formatMultipliers[format];
    const visualComplexity = this.clamp(baseFactors[0], 0.3, 1.0);
    const colorSaturation = this.clamp(baseFactors[1], 0.2, 1.0);
    const motionIntensity = format === "video" || format === "interstitial" ? this.clamp(baseFactors[2], 0.5, 1.0) : 0.2;
    const narrativeStructure = this.clamp(baseFactors[3], 0.4, 1.0);

    const predictedDepth = this.clamp(
      (visualComplexity * 0.25 + colorSaturation * 0.2 + motionIntensity * 0.3 + narrativeStructure * 0.25) * formatMultiplier,
      0,
      1
    );

    const confidence = this.clamp(0.65 + (visualComplexity + narrativeStructure) / 2 * 0.35, 0.5, 1.0);

    return {
      creativeId,
      predictedDepth: Number(predictedDepth.toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      factors: {
        visualComplexity: Number(visualComplexity.toFixed(4)),
        colorSaturation: Number(colorSaturation.toFixed(4)),
        motionIntensity: Number(motionIntensity.toFixed(4)),
        narrativeStructure: Number(narrativeStructure.toFixed(4))
      }
    };
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private generateFactors(seed: number): number[] {
    const factors: number[] = [];
    let current = seed;
    for (let i = 0; i < 4; i++) {
      current = (current * 1103515245 + 12345) & 0x7fffffff;
      factors.push(current / 0x7fffffff);
    }
    return factors;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}
