/**
 * yield-arbitrage.test.ts
 * Comprehensive tests for the Algorithmic Arbitrage Bidding System.
 * Tests BidAggregator, ArbitrageEngine, and yield API routes.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { BidAggregator, type DspBid } from "../src/services/BidAggregator";
import { ArbitrageEngine, type UserPulseData } from "../src/services/ArbitrageEngine";

// ── BidAggregator Tests ──────────────────────────────────────────────────────

test("BidAggregator: accepts valid bid within timeout", () => {
  const aggregator = new BidAggregator({ bidTimeoutMs: 10 });
  const bid: DspBid = {
    bidId: "bid-001",
    dspId: "dsp-alpha",
    campaignId: "camp-001",
    cpm: 5.5,
    creativeId: "creative-banner-001",
    creativeFormat: "banner",
    targetingParams: { geo: "US", age: "25-34" },
    submittedAt: Date.now(),
    ttlMs: 5000
  };

  const result = aggregator.ingestBid("slot-001", bid);
  assert.strictEqual(result.accepted, true);
});

test("BidAggregator: rejects bid exceeding timeout", () => {
  const aggregator = new BidAggregator({ bidTimeoutMs: 10 });
  const bid: DspBid = {
    bidId: "bid-002",
    dspId: "dsp-beta",
    campaignId: "camp-002",
    cpm: 3.2,
    creativeId: "creative-video-001",
    creativeFormat: "video",
    targetingParams: {},
    submittedAt: Date.now() - 20,
    ttlMs: 3000
  };

  const result = aggregator.ingestBid("slot-002", bid);
  assert.strictEqual(result.accepted, false);
  assert.ok(result.reason?.includes("bid_timeout"));
});

test("BidAggregator: rejects bid with zero/negative CPM", () => {
  const aggregator = new BidAggregator();
  const bid: DspBid = {
    bidId: "bid-003",
    dspId: "dsp-gamma",
    campaignId: "camp-003",
    cpm: 0,
    creativeId: "creative-native-001",
    creativeFormat: "native",
    targetingParams: {},
    submittedAt: Date.now(),
    ttlMs: 4000
  };

  const result = aggregator.ingestBid("slot-003", bid);
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.reason, "invalid_cpm: must be positive");
});

test("BidAggregator: ranks bids by effective CPM", () => {
  const aggregator = new BidAggregator();
  const now = Date.now();

  const bid1: DspBid = {
    bidId: "bid-high",
    dspId: "dsp-001",
    campaignId: "camp-001",
    cpm: 10.0,
    creativeId: "creative-001",
    creativeFormat: "video",
    targetingParams: {},
    submittedAt: now,
    ttlMs: 5000
  };

  const bid2: DspBid = {
    bidId: "bid-low",
    dspId: "dsp-002",
    campaignId: "camp-002",
    cpm: 2.0,
    creativeId: "creative-002",
    creativeFormat: "banner",
    targetingParams: {},
    submittedAt: now,
    ttlMs: 5000
  };

  aggregator.ingestBid("slot-rank-test", bid1);
  aggregator.ingestBid("slot-rank-test", bid2);

  const topBids = aggregator.getTopBids("slot-rank-test", 10);
  assert.strictEqual(topBids.length, 2);
  assert.strictEqual(topBids[0].rank, 1);
  assert.strictEqual(topBids[1].rank, 2);
  assert.ok(topBids[0].effectiveCpm > topBids[1].effectiveCpm);
});

test("BidAggregator: prunes expired bids", () => {
  const aggregator = new BidAggregator();
  const now = Date.now();

  const expiredBid: DspBid = {
    bidId: "bid-expired",
    dspId: "dsp-001",
    campaignId: "camp-001",
    cpm: 5.0,
    creativeId: "creative-001",
    creativeFormat: "banner",
    targetingParams: {},
    submittedAt: now,
    ttlMs: 1
  };

  aggregator.ingestBid("slot-prune", expiredBid);

  setTimeout(() => {
    const bids = aggregator.getTopBids("slot-prune", 10);
    assert.strictEqual(bids.length, 0);
  }, 10);
});

test("BidAggregator: getStats returns accurate metrics", () => {
  const aggregator = new BidAggregator();
  const now = Date.now();

  for (let i = 0; i < 5; i++) {
    const bid: DspBid = {
      bidId: `bid-${i}`,
      dspId: "dsp-001",
      campaignId: "camp-001",
      cpm: 5.0 + i,
      creativeId: `creative-${i}`,
      creativeFormat: "banner",
      targetingParams: {},
      submittedAt: now,
      ttlMs: 10000
    };
    aggregator.ingestBid("slot-stats", bid);
  }

  const stats = aggregator.getStats();
  assert.strictEqual(stats.totalSlots, 1);
  assert.strictEqual(stats.totalActiveBids, 5);
  assert.strictEqual(stats.avgBidsPerSlot, 5);
});

test("BidAggregator: clearSlot removes all bids", () => {
  const aggregator = new BidAggregator();
  const now = Date.now();

  const bid: DspBid = {
    bidId: "bid-clear",
    dspId: "dsp-001",
    campaignId: "camp-001",
    cpm: 5.0,
    creativeId: "creative-001",
    creativeFormat: "banner",
    targetingParams: {},
    submittedAt: now,
    ttlMs: 10000
  };

  aggregator.ingestBid("slot-clear", bid);
  assert.strictEqual(aggregator.getTopBids("slot-clear", 10).length, 1);

  aggregator.clearSlot("slot-clear");
  assert.strictEqual(aggregator.getTopBids("slot-clear", 10).length, 0);
});

// ── ArbitrageEngine Tests ────────────────────────────────────────────────────

test("ArbitrageEngine: executes arbitrage and returns match", () => {
  const engine = new ArbitrageEngine();
  const now = Date.now();

  const bids = [
    {
      bidId: "bid-001",
      dspId: "dsp-alpha",
      campaignId: "camp-001",
      cpm: 8.0,
      creativeId: "creative-001",
      creativeFormat: "video" as const,
      targetingParams: {},
      submittedAt: now,
      ttlMs: 5000,
      attentionScore: 0.85,
      effectiveCpm: 12.5,
      expiresAt: now + 5000,
      rank: 1
    }
  ];

  const userPulse: UserPulseData = {
    userId: "user-001",
    attentionState: "deep",
    attentionScore: 0.9,
    sessionDurationMs: 120000,
    recentInteractionCount: 15,
    scrollVelocity: 50,
    deviceType: "desktop",
    timestamp: now
  };

  const match = engine.executeArbitrage("slot-001", bids, userPulse);
  assert.ok(match);
  assert.strictEqual(match.selectedBid.bidId, "bid-001");
  assert.strictEqual(match.slotId, "slot-001");
  assert.ok(match.expectedYield > 0);
  assert.ok(match.executionLatencyMs >= 0);
});

test("ArbitrageEngine: returns null when no bids available", () => {
  const engine = new ArbitrageEngine();
  const userPulse: UserPulseData = {
    userId: "user-002",
    attentionState: "fragmented",
    attentionScore: 0.3,
    sessionDurationMs: 10000,
    recentInteractionCount: 2,
    scrollVelocity: 500,
    deviceType: "mobile",
    timestamp: Date.now()
  };

  const match = engine.executeArbitrage("slot-empty", [], userPulse);
  assert.strictEqual(match, null);
});

test("ArbitrageEngine: selects micro-burst format for fragmented attention", () => {
  const engine = new ArbitrageEngine();
  const now = Date.now();

  const bids = [
    {
      bidId: "bid-video",
      dspId: "dsp-alpha",
      campaignId: "camp-001",
      cpm: 5.0,
      creativeId: "creative-video",
      creativeFormat: "video" as const,
      targetingParams: {},
      submittedAt: now,
      ttlMs: 5000,
      attentionScore: 0.4,
      effectiveCpm: 6.5,
      expiresAt: now + 5000,
      rank: 1
    }
  ];

  const userPulse: UserPulseData = {
    userId: "user-fragmented",
    attentionState: "fragmented",
    attentionScore: 0.25,
    sessionDurationMs: 5000,
    recentInteractionCount: 1,
    scrollVelocity: 800,
    deviceType: "mobile",
    timestamp: now
  };

  const match = engine.executeArbitrage("slot-fragmented", bids, userPulse);
  assert.ok(match);
  assert.strictEqual(match.recommendedFormat, "micro-burst");
});

test("ArbitrageEngine: selects narrative-longform for deep attention", () => {
  const engine = new ArbitrageEngine();
  const now = Date.now();

  const bids = [
    {
      bidId: "bid-video-deep",
      dspId: "dsp-beta",
      campaignId: "camp-002",
      cpm: 8.0,
      creativeId: "creative-video-deep",
      creativeFormat: "video" as const,
      targetingParams: {},
      submittedAt: now,
      ttlMs: 5000,
      attentionScore: 0.9,
      effectiveCpm: 12.0,
      expiresAt: now + 5000,
      rank: 1
    }
  ];

  const userPulse: UserPulseData = {
    userId: "user-deep",
    attentionState: "deep",
    attentionScore: 0.95,
    sessionDurationMs: 300000,
    recentInteractionCount: 50,
    scrollVelocity: 20,
    deviceType: "desktop",
    timestamp: now
  };

  const match = engine.executeArbitrage("slot-deep", bids, userPulse);
  assert.ok(match);
  assert.strictEqual(match.recommendedFormat, "narrative-longform");
});

test("ArbitrageEngine: calculates attention alignment correctly", () => {
  const engine = new ArbitrageEngine();
  const now = Date.now();

  const highAlignmentBid = {
    bidId: "bid-aligned",
    dspId: "dsp-001",
    campaignId: "camp-001",
    cpm: 5.0,
    creativeId: "creative-001",
    creativeFormat: "native" as const,
    targetingParams: {},
    submittedAt: now,
    ttlMs: 5000,
    attentionScore: 0.8,
    effectiveCpm: 7.0,
    expiresAt: now + 5000,
    rank: 1
  };

  const userPulse: UserPulseData = {
    userId: "user-aligned",
    attentionState: "steady",
    attentionScore: 0.75,
    sessionDurationMs: 60000,
    recentInteractionCount: 10,
    scrollVelocity: 100,
    deviceType: "tablet",
    timestamp: now
  };

  const match = engine.executeArbitrage("slot-alignment", [highAlignmentBid], userPulse);
  assert.ok(match);
  assert.ok(match.attentionAlignment > 0.9);
});

test("ArbitrageEngine: getMetrics returns correct structure", () => {
  const engine = new ArbitrageEngine();
  const now = Date.now();

  const bid = {
    bidId: "bid-metrics",
    dspId: "dsp-001",
    campaignId: "camp-001",
    cpm: 5.0,
    creativeId: "creative-001",
    creativeFormat: "banner" as const,
    targetingParams: {},
    submittedAt: now,
    ttlMs: 5000,
    attentionScore: 0.6,
    effectiveCpm: 7.5,
    expiresAt: now + 5000,
    rank: 1
  };

  const userPulse: UserPulseData = {
    userId: "user-metrics",
    attentionState: "steady",
    attentionScore: 0.65,
    sessionDurationMs: 45000,
    recentInteractionCount: 8,
    scrollVelocity: 150,
    deviceType: "desktop",
    timestamp: now
  };

  engine.executeArbitrage("slot-metrics", [bid], userPulse);
  const metrics = engine.getMetrics();

  assert.strictEqual(metrics.totalMatches, 1);
  assert.ok(metrics.totalYield > 0);
  assert.ok(metrics.avgExecutionLatencyMs >= 0);
  assert.ok(metrics.formatDistribution);
  assert.ok(metrics.attentionStateDistribution);
  assert.ok(metrics.yieldByFormat);
});

test("ArbitrageEngine: clears history correctly", () => {
  const engine = new ArbitrageEngine();
  const now = Date.now();

  const bid = {
    bidId: "bid-clear",
    dspId: "dsp-001",
    campaignId: "camp-001",
    cpm: 5.0,
    creativeId: "creative-001",
    creativeFormat: "banner" as const,
    targetingParams: {},
    submittedAt: now,
    ttlMs: 5000,
    attentionScore: 0.6,
    effectiveCpm: 7.5,
    expiresAt: now + 5000,
    rank: 1
  };

  const userPulse: UserPulseData = {
    userId: "user-clear",
    attentionState: "steady",
    attentionScore: 0.65,
    sessionDurationMs: 45000,
    recentInteractionCount: 8,
    scrollVelocity: 150,
    deviceType: "desktop",
    timestamp: now
  };

  engine.executeArbitrage("slot-clear", [bid], userPulse);
  assert.strictEqual(engine.getMetrics().totalMatches, 1);

  engine.clearHistory();
  assert.strictEqual(engine.getMetrics().totalMatches, 0);
});

test("ArbitrageEngine: execution latency is reasonable (<10ms)", () => {
  const engine = new ArbitrageEngine();
  const now = Date.now();

  const bids = Array.from({ length: 20 }, (_, i) => ({
    bidId: `bid-${i}`,
    dspId: `dsp-${i % 5}`,
    campaignId: `camp-${i}`,
    cpm: 3.0 + Math.random() * 7.0,
    creativeId: `creative-${i}`,
    creativeFormat: (["banner", "video", "native", "interstitial"] as const)[i % 4],
    targetingParams: {},
    submittedAt: now,
    ttlMs: 5000,
    attentionScore: Math.random(),
    effectiveCpm: 5.0 + Math.random() * 10.0,
    expiresAt: now + 5000,
    rank: i + 1
  }));

  const userPulse: UserPulseData = {
    userId: "user-latency-test",
    attentionState: "steady",
    attentionScore: 0.7,
    sessionDurationMs: 60000,
    recentInteractionCount: 12,
    scrollVelocity: 120,
    deviceType: "desktop",
    timestamp: now
  };

  const match = engine.executeArbitrage("slot-latency", bids, userPulse);
  assert.ok(match);
  assert.ok(match.executionLatencyMs < 10, `Execution latency ${match.executionLatencyMs}ms exceeds 10ms threshold`);
});
