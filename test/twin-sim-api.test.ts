import test, { after } from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { createAppServer } from "../src/server";

const server = createAppServer();
let baseUrl = "";

test("start Quantads API test server", async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

test("POST /api/v1/twin-sim simulates variants and returns an x402 payment quote", async () => {
  const response = await fetch(`${baseUrl}/api/v1/twin-sim`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      campaignId: "campaign-alpha",
      agencyId: "agency-alpha",
      outcomeType: "booked-meeting",
      baseOutcomePrice: 25,
      settlementAddress: "0xagencysettlement",
      settlementNetwork: "base",
      variants: [
        {
          id: "variant-a",
          headline: "Meet your next enterprise buyer",
          callToAction: "Book a demo",
          creativeWeight: 1.05,
          tags: ["enterprise", "demo"]
        },
        {
          id: "variant-b",
          headline: "Scale pipeline with verified buyers",
          callToAction: "Schedule time",
          creativeWeight: 0.95,
          tags: ["pipeline", "buyers"]
        }
      ],
      audience: [
        {
          id: "twin-1",
          verifiedLtv: 125,
          intentScore: 0.88,
          conversionProbability: 0.45,
          interests: ["enterprise", "demo"],
          priceSensitivity: 0.1
        },
        {
          id: "twin-2",
          verifiedLtv: 90,
          intentScore: 0.67,
          conversionProbability: 0.32,
          interests: ["pipeline", "buyers"],
          priceSensitivity: 0.25
        }
      ]
    })
  });

  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    pricingModel: string;
    winnerVariantId: string;
    paymentQuote: { protocol: string; pricingModel: string };
    results: Array<{ variantId: string }>;
  };

  assert.equal(body.pricingModel, "outcome-based");
  assert.equal(body.paymentQuote.protocol, "x402");
  assert.equal(body.paymentQuote.pricingModel, "per-outcome");
  assert.equal(body.results.length, 2);
  assert.ok(["variant-a", "variant-b"].includes(body.winnerVariantId));
});

test("POST /api/v1/twin-sim returns 400 for invalid payloads", async () => {
  const response = await fetch(`${baseUrl}/api/v1/twin-sim`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ campaignId: "broken-payload" })
  });

  assert.equal(response.status, 400);
});
