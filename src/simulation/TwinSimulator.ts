import { BiddingEngine } from "../bidding/BiddingEngine";
import { createOutcomeQuote, OutcomePaymentQuote } from "../payments/x402";

export interface AdVariant {
  id: string;
  headline: string;
  callToAction: string;
  creativeWeight?: number;
  tags?: string[];
}

export interface DigitalTwin {
  id: string;
  verifiedLtv: number;
  intentScore: number;
  conversionProbability: number;
  priceSensitivity?: number;
  interests?: string[];
}

export interface TwinSimulationRequest {
  campaignId: string;
  agencyId: string;
  outcomeType: string;
  baseOutcomePrice: number;
  settlementAddress: string;
  settlementNetwork: string;
  variants: AdVariant[];
  audience: DigitalTwin[];
}

export interface VariantSimulationResult {
  variantId: string;
  projectedOutcomes: number;
  projectedSpend: number;
  averageOutcomeProbability: number;
  recommendedBid: number;
}

export interface TwinSimulationResult {
  campaignId: string;
  pricingModel: "outcome-based";
  audienceSize: number;
  winnerVariantId: string;
  paymentQuote: OutcomePaymentQuote;
  results: VariantSimulationResult[];
}

const clamp = (value: number, minimum: number, maximum: number): number => {
  return Math.min(Math.max(value, minimum), maximum);
};

const round = (value: number): number => Number(value.toFixed(3));

const countTagOverlap = (variant: AdVariant, twin: DigitalTwin): number => {
  if (!variant.tags?.length || !twin.interests?.length) {
    return 0;
  }

  const twinTags = new Set(twin.interests.map((interest) => interest.toLowerCase()));

  return variant.tags.reduce((matches, tag) => {
    return matches + (twinTags.has(tag.toLowerCase()) ? 1 : 0);
  }, 0);
};

export class TwinSimulator {
  private readonly biddingEngine: BiddingEngine;

  constructor(biddingEngine = new BiddingEngine()) {
    this.biddingEngine = biddingEngine;
  }

  simulate(request: TwinSimulationRequest): TwinSimulationResult {
    if (!request.variants.length) {
      throw new Error("variants must contain at least one ad variant");
    }

    if (!request.audience.length) {
      throw new Error("audience must contain at least one digital twin");
    }

    const results = request.variants.map((variant) => {
      const projectedProbabilities = request.audience.map((twin) => {
        const overlapScore = countTagOverlap(variant, twin);
        const tagBonus = overlapScore * 0.05;
        const creativeWeight = variant.creativeWeight ?? 1;
        const priceSensitivity = twin.priceSensitivity ?? 0.2;

        return clamp(
          twin.conversionProbability * creativeWeight +
            twin.intentScore * 0.2 +
            tagBonus -
            priceSensitivity * 0.05,
          0.01,
          0.98
        );
      });

      const averageOutcomeProbability =
        projectedProbabilities.reduce((sum, probability) => sum + probability, 0) /
        projectedProbabilities.length;
      const averageAudience = request.audience.reduce(
        (totals, twin) => {
          totals.verifiedLtv += twin.verifiedLtv;
          totals.intentScore += twin.intentScore;
          totals.conversionRate += twin.conversionProbability;

          return totals;
        },
        { verifiedLtv: 0, intentScore: 0, conversionRate: 0 }
      );
      const audienceSize = request.audience.length;
      const bid = this.biddingEngine.calculateOutcomeBid({
        baseOutcomePrice: request.baseOutcomePrice,
        audience: {
          verifiedLtv: averageAudience.verifiedLtv / audienceSize,
          intentScore: averageAudience.intentScore / audienceSize,
          conversionRate: averageAudience.conversionRate / audienceSize,
          recencyMultiplier: variant.creativeWeight ?? 1
        }
      });
      const projectedOutcomes = projectedProbabilities.reduce(
        (sum, probability) => sum + probability,
        0
      );

      return {
        variantId: variant.id,
        projectedOutcomes: round(projectedOutcomes),
        projectedSpend: round(projectedOutcomes * bid.finalBid),
        averageOutcomeProbability: round(averageOutcomeProbability),
        recommendedBid: bid.finalBid
      };
    });

    const winner = results.reduce((best, current) => {
      if (current.projectedOutcomes > best.projectedOutcomes) {
        return current;
      }

      if (
        current.projectedOutcomes === best.projectedOutcomes &&
        current.projectedSpend < best.projectedSpend
      ) {
        return current;
      }

      return best;
    });

    return {
      campaignId: request.campaignId,
      pricingModel: "outcome-based",
      audienceSize: request.audience.length,
      winnerVariantId: winner.variantId,
      paymentQuote: createOutcomeQuote({
        agencyId: request.agencyId,
        campaignId: request.campaignId,
        outcomeType: request.outcomeType,
        outcomeCount: Math.max(1, Math.round(winner.projectedOutcomes)),
        unitPrice: winner.recommendedBid,
        settlementAddress: request.settlementAddress,
        settlementNetwork: request.settlementNetwork
      }),
      results
    };
  }
}
