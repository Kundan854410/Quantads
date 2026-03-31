import { randomUUID } from "node:crypto";

export interface OutcomePaymentRequest {
  agencyId: string;
  campaignId: string;
  outcomeType: string;
  outcomeCount: number;
  unitPrice: number;
  settlementAddress: string;
  settlementNetwork: string;
  currency?: string;
}

export interface OutcomePaymentQuote {
  invoiceId: string;
  protocol: "x402";
  pricingModel: "per-outcome";
  campaignId: string;
  agencyId: string;
  outcomeType: string;
  outcomeCount: number;
  unitPrice: number;
  totalAmount: number;
  currency: string;
  settlementAddress: string;
  settlementNetwork: string;
  paymentEndpoint: string;
  status: "quoted";
}

export interface OutcomePaymentAuthorization {
  invoiceId: string;
  payerWallet: string;
  transactionHash: string;
  amount: number;
  currency: string;
}

export interface SettledOutcomePayment
  extends Omit<OutcomePaymentQuote, "status"> {
  status: "settled";
  payerWallet: string;
  transactionHash: string;
  settledAmount: number;
}

const roundCurrency = (value: number): number => Number(value.toFixed(2));

export class X402PaymentError extends Error {}

export const createOutcomeQuote = (
  request: OutcomePaymentRequest
): OutcomePaymentQuote => {
  if (request.outcomeCount <= 0) {
    throw new X402PaymentError("outcomeCount must be greater than zero");
  }

  if (request.unitPrice <= 0) {
    throw new X402PaymentError("unitPrice must be greater than zero");
  }

  const currency = request.currency ?? "USDC";

  return {
    invoiceId: randomUUID(),
    protocol: "x402",
    pricingModel: "per-outcome",
    campaignId: request.campaignId,
    agencyId: request.agencyId,
    outcomeType: request.outcomeType,
    outcomeCount: request.outcomeCount,
    unitPrice: roundCurrency(request.unitPrice),
    totalAmount: roundCurrency(request.outcomeCount * request.unitPrice),
    currency,
    settlementAddress: request.settlementAddress,
    settlementNetwork: request.settlementNetwork,
    paymentEndpoint: `/api/v1/payments/x402/${request.campaignId}`,
    status: "quoted"
  };
};

export const settleOutcomePayment = (
  quote: OutcomePaymentQuote,
  authorization: OutcomePaymentAuthorization
): SettledOutcomePayment => {
  if (quote.invoiceId !== authorization.invoiceId) {
    throw new X402PaymentError("invoiceId does not match quote");
  }

  if (authorization.amount < quote.totalAmount) {
    throw new X402PaymentError("authorization amount is lower than the quoted total");
  }

  if (authorization.currency !== quote.currency) {
    throw new X402PaymentError("authorization currency does not match quote currency");
  }

  if (!authorization.transactionHash.trim()) {
    throw new X402PaymentError("transactionHash is required");
  }

  if (!authorization.payerWallet.trim()) {
    throw new X402PaymentError("payerWallet is required");
  }

  return {
    ...quote,
    status: "settled",
    payerWallet: authorization.payerWallet,
    transactionHash: authorization.transactionHash,
    settledAmount: roundCurrency(authorization.amount)
  };
};
