import { createServer } from "node:http";
import { InfraiClient, InfraiError } from "./infrai_client.ts";
import { incidentRequestSchema, runIncidentDrill } from "./work_order_incident.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const operator = new InfraiClient(apiKey);

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/incident-drills") {
    send(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = incidentRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) {
      send(response, 400, { error: "Invalid incident request", issues: parsed.error.issues });
      return;
    }
    send(response, 200, await runIncidentDrill(operator, parsed.data));
  } catch (error) {
    if (error instanceof SyntaxError) send(response, 400, { error: "Request body must be JSON" });
    else if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, detail: error.detail });
    } else send(response, 502, { error: "Incident drill could not be completed" });
  }
});

const port = Number(process.env.PORT ?? "3000");
server.listen(port, () => console.log(`Field incident service listening on http://localhost:${port}`));
