import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { TwinSimulationRequest, TwinSimulator } from "./simulation/TwinSimulator";

const twinSimulator = new TwinSimulator();

const sendJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const isTwinSimulationRequest = (value: unknown): value is TwinSimulationRequest => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const request = value as Record<string, unknown>;

  return (
    typeof request.campaignId === "string" &&
    typeof request.agencyId === "string" &&
    typeof request.outcomeType === "string" &&
    typeof request.baseOutcomePrice === "number" &&
    typeof request.settlementAddress === "string" &&
    typeof request.settlementNetwork === "string" &&
    Array.isArray(request.variants) &&
    Array.isArray(request.audience)
  );
};

export const requestListener = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  if (request.method === "POST" && request.url === "/api/v1/twin-sim") {
    try {
      const payload = await readJson(request);

      if (!isTwinSimulationRequest(payload)) {
        sendJson(response, 400, {
          error: "Invalid twin simulation request payload"
        });

        return;
      }

      sendJson(response, 200, twinSimulator.simulate(payload));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Twin simulation request failed";
      sendJson(response, 400, { error: message });
    }

    return;
  }

  sendJson(response, 404, { error: "Not found" });
};

export const createAppServer = () => createServer((request, response) => {
  void requestListener(request, response);
});

if (require.main === module) {
  const port = Number(process.env.PORT ?? "3000");
  const server = createAppServer();

  server.listen(port, () => {
    process.stdout.write(`Quantads API listening on port ${port}\n`);
  });
}
