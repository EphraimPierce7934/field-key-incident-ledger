import { z } from "zod";
import { InfraiClient } from "./infrai_client.ts";

export const incidentRequestSchema = z.object({
  workOrderId: z.string().min(1),
  photo: z.object({
    assetId: z.string().min(1),
    review: z.enum(["accepted", "retake"]),
  }),
  dispatchStatus: z.enum(["assigned", "en_route", "delayed", "completed"]),
  technicianId: z.string().min(1),
});

export type IncidentRequest = z.infer<typeof incidentRequestSchema>;
export type FollowUp = { required: boolean; reason: "photo_retake" | "dispatch_delay" | "none" };
export type LogEntry = {
  timestamp: string;
  level: "info" | "warn";
  service: string;
  environment: string;
  trace_id: string;
  message: string;
  metadata: Record<string, string | boolean>;
};

type CreatedKey = { key_id: string; key_secret: string };

export function decideFollowUp(input: IncidentRequest): FollowUp {
  if (input.photo.review === "retake") return { required: true, reason: "photo_retake" };
  if (input.dispatchStatus === "delayed") return { required: true, reason: "dispatch_delay" };
  return { required: false, reason: "none" };
}

export function workOrderEntries(
  input: IncidentRequest,
  affectedKeyId: string,
  now = new Date().toISOString(),
): LogEntry[] {
  const followUp = decideFollowUp(input);
  const common = {
    timestamp: now,
    service: "field-dispatch",
    environment: "incident-drill",
    trace_id: input.workOrderId,
  } as const;
  return [
    {
      ...common,
      level: "info",
      message: "work-order photo recorded",
      metadata: {
        affected_key_id: affectedKeyId,
        work_order_id: input.workOrderId,
        photo_asset_id: input.photo.assetId,
        photo_review: input.photo.review,
      },
    },
    {
      ...common,
      level: input.dispatchStatus === "delayed" ? "warn" : "info",
      message: "dispatch status recorded",
      metadata: {
        affected_key_id: affectedKeyId,
        work_order_id: input.workOrderId,
        technician_id: input.technicianId,
        dispatch_status: input.dispatchStatus,
        follow_up_required: followUp.required,
        follow_up_reason: followUp.reason,
      },
    },
  ];
}

export async function runIncidentDrill(operator: InfraiClient, input: IncidentRequest) {
  const runId = `${input.workOrderId}-${Date.now()}`;
  const created = await operator.request<CreatedKey>("POST", "/v1/account/keys/create", {
    body: {
      name: `field-drill-${input.workOrderId}`,
      scopes: ["logs.ingest"],
      idempotency_key: `create-${runId}`,
    },
  });
  if (!created.key_id || !created.key_secret) throw new Error("Key creation response is incomplete");

  const affectedKey = new InfraiClient(created.key_secret);
  await affectedKey.request("POST", "/v1/logs/ingest", {
    body: {
      entries: workOrderEntries(input, created.key_id),
      idempotency_key: `work-order-${runId}`,
    },
  });

  await operator.request("POST", `/v1/account/keys/suspected_compromise/${encodeURIComponent(created.key_id)}`, {
    body: { confirmed_leak: true, auto_rotate: false },
  });
  const blastRadius = await operator.request<unknown>("GET", "/v1/logs/search", {
    query: { q: created.key_id },
  });
  await operator.request("POST", `/v1/account/keys/rotate/${encodeURIComponent(created.key_id)}`, {
    body: { grace_hours: 1, idempotency_key: `rotate-${runId}` },
  });
  await operator.request("DELETE", `/v1/account/keys/revoke/${encodeURIComponent(created.key_id)}`);

  return {
    workOrderId: input.workOrderId,
    affectedKeyId: created.key_id,
    followUp: decideFollowUp(input),
    blastRadius,
    keyState: "revoked_after_rotation" as const,
  };
}
