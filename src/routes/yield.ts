/**
 * yield.ts
 * API routes for the Algorithmic Arbitrage Bidding System.
 * Handles bid aggregation, arbitrage execution, and yield dashboard data.
 */

import { IncomingMessage, ServerResponse } from "node:http";
import { BidAggregator, DspBid } from "../services/BidAggregator";
import { ArbitrageEngine, UserPulseData } from "../services/ArbitrageEngine";
import type { YieldSnapshot } from "../components/YieldDash";
import { logger } from "../lib/logger";
import { withAuth } from "../middleware/auth";

const bidAggregator = new BidAggregator();
const arbitrageEngine = new ArbitrageEngine();
const yieldSnapshots: YieldSnapshot[] = [];

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const sendJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

/**
 * POST /api/v1/yield/arbitrage/evaluate
 * Evaluates arbitrage opportunities for a given slot and user pulse data.
 */
export const handleArbitrageEvaluate = withAuth(async (request: IncomingMessage, response: ServerResponse, token) => {
  try {
    const body = await readJson(request) as { slotId: string; userPulse: UserPulseData };

    if (!body.slotId || typeof body.slotId !== "string") {
      sendJson(response, 422, { error: "validation_error", message: "slotId is required and must be a string" });
      return;
    }

    if (!body.userPulse || typeof body.userPulse !== "object") {
      sendJson(response, 422, { error: "validation_error", message: "userPulse is required and must be an object" });
      return;
    }

    const topBids = bidAggregator.getTopBids(body.slotId, 20);
    const match = arbitrageEngine.executeArbitrage(body.slotId, topBids, body.userPulse);

    if (!match) {
      sendJson(response, 200, { matched: false, reason: "no_eligible_bids" });
      return;
    }

    logger.info(
      {
        slotId: body.slotId,
        userId: body.userPulse.userId,
        bidId: match.selectedBid.bidId,
        yield: match.expectedYield,
        format: match.recommendedFormat
      },
      "arbitrage match executed"
    );

    sendJson(response, 200, { matched: true, match });
  } catch (error) {
    logger.error({ err: String(error) }, "arbitrage evaluate failed");
    sendJson(response, 500, { error: "internal_error", message: String(error) });
  }
});

/**
 * POST /api/v1/yield/bids/submit
 * Submits a DSP bid to the aggregator.
 */
export const handleBidSubmit = withAuth(async (request: IncomingMessage, response: ServerResponse, token) => {
  try {
    const body = await readJson(request) as { slotId: string; bid: DspBid };

    if (!body.slotId || typeof body.slotId !== "string") {
      sendJson(response, 422, { error: "validation_error", message: "slotId is required and must be a string" });
      return;
    }

    if (!body.bid || typeof body.bid !== "object") {
      sendJson(response, 422, { error: "validation_error", message: "bid is required and must be an object" });
      return;
    }

    const result = bidAggregator.ingestBid(body.slotId, body.bid);

    if (!result.accepted) {
      logger.warn({ slotId: body.slotId, bidId: body.bid.bidId, reason: result.reason }, "bid rejected");
      sendJson(response, 422, { accepted: false, reason: result.reason });
      return;
    }

    logger.info({ slotId: body.slotId, bidId: body.bid.bidId, cpm: body.bid.cpm }, "bid accepted");
    sendJson(response, 201, { accepted: true, bidId: body.bid.bidId });
  } catch (error) {
    logger.error({ err: String(error) }, "bid submit failed");
    sendJson(response, 500, { error: "internal_error", message: String(error) });
  }
});

/**
 * GET /api/v1/yield/dashboard
 * Returns yield dashboard data including metrics, snapshots, and recent bids.
 */
export const handleYieldDashboard = withAuth(async (request: IncomingMessage, response: ServerResponse, token) => {
  try {
    const metrics = arbitrageEngine.getMetrics();
    const aggregatorStats = bidAggregator.getStats();

    const snapshot: YieldSnapshot = {
      timestamp: Date.now(),
      totalYield: metrics.totalYield,
      avgExecutionLatencyMs: metrics.avgExecutionLatencyMs,
      bidVolume: aggregatorStats.totalActiveBids,
      topPerformingFormat: Object.entries(metrics.yieldByFormat)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || "none",
      yieldVelocity: metrics.totalMatches > 0 ? metrics.totalYield / metrics.totalMatches : 0
    };

    yieldSnapshots.push(snapshot);
    if (yieldSnapshots.length > 1000) {
      yieldSnapshots.splice(0, yieldSnapshots.length - 1000);
    }

    const recentBids: unknown[] = [];
    for (const slot of aggregatorStats.topSlotsByVolume.slice(0, 3)) {
      const slotBids = bidAggregator.getTopBids(slot.slotId, 5);
      recentBids.push(...slotBids);
    }

    logger.info({ metrics, aggregatorStats }, "yield dashboard requested");

    sendJson(response, 200, {
      metrics,
      aggregatorStats,
      recentBids,
      snapshots: yieldSnapshots.slice(-100)
    });
  } catch (error) {
    logger.error({ err: String(error) }, "yield dashboard failed");
    sendJson(response, 500, { error: "internal_error", message: String(error) });
  }
});

/**
 * GET /api/v1/yield/bids/:slotId
 * Returns top bids for a specific slot.
 */
export const handleSlotBids = withAuth(async (request: IncomingMessage, response: ServerResponse, token) => {
  try {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const slotId = url.pathname.split("/").pop();

    if (!slotId) {
      sendJson(response, 422, { error: "validation_error", message: "slotId is required" });
      return;
    }

    const limit = parseInt(url.searchParams.get("limit") || "10", 10);
    const bids = bidAggregator.getTopBids(slotId, limit);

    logger.info({ slotId, count: bids.length }, "slot bids requested");
    sendJson(response, 200, { slotId, bids, count: bids.length });
  } catch (error) {
    logger.error({ err: String(error) }, "slot bids failed");
    sendJson(response, 500, { error: "internal_error", message: String(error) });
  }
});

/**
 * DELETE /api/v1/yield/bids/:slotId
 * Clears all bids for a specific slot.
 */
export const handleClearSlot = withAuth(async (request: IncomingMessage, response: ServerResponse, token) => {
  try {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const slotId = url.pathname.split("/").pop();

    if (!slotId) {
      sendJson(response, 422, { error: "validation_error", message: "slotId is required" });
      return;
    }

    bidAggregator.clearSlot(slotId);

    logger.info({ slotId }, "slot cleared");
    sendJson(response, 200, { slotId, cleared: true });
  } catch (error) {
    logger.error({ err: String(error) }, "clear slot failed");
    sendJson(response, 500, { error: "internal_error", message: String(error) });
  }
});

/**
 * GET /internal/yield-dashboard
 * Serves the internal yield dashboard HTML page.
 */
export const handleYieldDashboardPage = withAuth(async (request: IncomingMessage, response: ServerResponse, token) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quantads Yield Dashboard</title>
  <style>
    body { margin: 0; padding: 0; background: #000; color: #0f0; font-family: monospace; }
    #root { width: 100%; height: 100vh; }
  </style>
</head>
<body>
  <div id="root">Loading Yield Dashboard...</div>
  <script>
    fetch('/api/v1/yield/dashboard', {
      headers: { 'Authorization': 'Bearer ${token}' }
    })
    .then(res => res.json())
    .then(data => {
      document.getElementById('root').innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
      setInterval(() => {
        fetch('/api/v1/yield/dashboard', {
          headers: { 'Authorization': 'Bearer ${token}' }
        })
        .then(res => res.json())
        .then(data => {
          document.getElementById('root').innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
        });
      }, 5000);
    });
  </script>
</body>
</html>
  `;

  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
