import assert from "node:assert/strict";
import test from "node:test";
import { InfraiClient, type InfraiPath } from "./infrai_client.ts";
import { decideFollowUp, incidentRequestSchema, runIncidentDrill, workOrderEntries } from "./work_order_incident.ts";

test("a rejected completion photo schedules technician follow-up", () => {
  const input = incidentRequestSchema.parse({
    workOrderId: "wo-2048",
    photo: { assetId: "photo-88", review: "retake" },
    dispatchStatus: "completed",
    technicianId: "tech-17",
  });

  assert.deepEqual(decideFollowUp(input), { required: true, reason: "photo_retake" });
  const entries = workOrderEntries(input, "key-demo", "2026-09-27T08:00:00.000Z");
  assert.equal(entries.length, 2);
  assert.equal(entries[1].metadata.follow_up_required, true);
  assert.equal(entries[1].metadata.follow_up_reason, "photo_retake");
  assert.ok(entries.every((entry) => entry.metadata.affected_key_id === "key-demo"));
});

test("an accepted photo with completed dispatch closes follow-up", () => {
  const input = incidentRequestSchema.parse({
    workOrderId: "wo-2049",
    photo: { assetId: "photo-89", review: "accepted" },
    dispatchStatus: "completed",
    technicianId: "tech-18",
  });
  assert.deepEqual(decideFollowUp(input), { required: false, reason: "none" });
});

test("the created key secret authenticates log ingestion", async () => {
  const calls: Array<{ path: string; apiKey: string }> = [];
  const originalRequest = InfraiClient.prototype.request;
  InfraiClient.prototype.request = async function <T>(
    _method: "GET" | "POST" | "DELETE",
    path: InfraiPath,
  ): Promise<T> {
    calls.push({ path, apiKey: (this as unknown as { apiKey: string }).apiKey });
    if (path === "/v1/account/keys/create") return { key_id: "key-demo", key_secret: "secret-demo" } as T;
    return {} as T;
  };

  try {
    await runIncidentDrill(
      new InfraiClient("operator-demo"),
      incidentRequestSchema.parse({
        workOrderId: "wo-2050",
        photo: { assetId: "photo-90", review: "accepted" },
        dispatchStatus: "completed",
        technicianId: "tech-19",
      }),
    );
  } finally {
    InfraiClient.prototype.request = originalRequest;
  }

  assert.deepEqual(calls.slice(0, 2), [
    { path: "/v1/account/keys/create", apiKey: "operator-demo" },
    { path: "/v1/logs/ingest", apiKey: "secret-demo" },
  ]);
});
