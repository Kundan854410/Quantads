import test from "node:test";
import assert from "node:assert/strict";
import {
  createOutcomeQuote,
  settleOutcomePayment,
  X402PaymentError
} from "../src/payments/x402";

test("x402 outcome quote uses per-outcome totals and settles matching payments", () => {
  const quote = createOutcomeQuote({
    agencyId: "agency-1",
    campaignId: "cmp-1",
    outcomeType: "booked-meeting",
    outcomeCount: 3,
    unitPrice: 18.5,
    settlementAddress: "0xabc123",
    settlementNetwork: "base"
  });

  assert.equal(quote.protocol, "x402");
  assert.equal(quote.totalAmount, 55.5);
  assert.equal(quote.pricingModel, "per-outcome");

  const settled = settleOutcomePayment(quote, {
    invoiceId: quote.invoiceId,
    payerWallet: "0xpayer",
    transactionHash: "0xtxhash",
    amount: quote.totalAmount,
    currency: quote.currency
  });

  assert.equal(settled.status, "settled");
  assert.equal(settled.settledAmount, 55.5);
});

test("x402 settlement rejects underpayments", () => {
  const quote = createOutcomeQuote({
    agencyId: "agency-2",
    campaignId: "cmp-2",
    outcomeType: "app-install",
    outcomeCount: 2,
    unitPrice: 4,
    settlementAddress: "0xdef456",
    settlementNetwork: "polygon"
  });

  assert.throws(
    () =>
      settleOutcomePayment(quote, {
        invoiceId: quote.invoiceId,
        payerWallet: "0xpayer",
        transactionHash: "0xtxhash",
        amount: 6,
        currency: quote.currency
      }),
    X402PaymentError
  );
});
