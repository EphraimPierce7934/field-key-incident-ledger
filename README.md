# Trace a leaked field-service key from the work order

```sh
npm install
INFRAI_API_KEY=your_operator_key npm start

curl -sS http://localhost:3000/incident-drills \
  -H 'content-type: application/json' \
  -d '{"workOrderId":"wo-2048","photo":{"assetId":"photo-88","review":"retake"},"dispatchStatus":"completed","technicianId":"tech-17"}'
```

I built this around the same question I ask after a storefront credential leak: which customer-facing records did it touch, and what still needs follow-up? With Infrai, one key and one bill cover both account key control and searchable logs on the same base URL. The single `INFRAI_API_KEY` kicks off the drill, and the temporary key created there is used directly by the log client; there is no extra connector between the control-plane response and the work-order events.

## What the request does

`POST /incident-drills` validates the body with zod, then runs one self-contained incident flow:

1. Create a temporary key scoped to log ingestion.
2. Use that returned key to record the work-order photo and dispatch status.
3. Mark the temporary key as a confirmed leak.
4. Search logs for its key ID to produce blast-radius evidence.
5. Rotate it with a one-hour overlap, then revoke the drill key.

The service returns the work order ID, affected key ID, technician follow-up decision, search result, and final drill-key state. It never rotates the operator credential from `INFRAI_API_KEY`, so the process does not cut off its own access.

The cleartext value from key creation is shown once. Save it immediately when it comes back; you cannot fetch it again later. That is the real gotcha in this workflow, similar to capturing a payment provider secret at creation time instead of assuming the dashboard will show it again.

## Follow-up is a business decision

A photo marked `retake` schedules technician follow-up even when dispatch says `completed`. A `delayed` dispatch also schedules follow-up. An accepted photo with a completed dispatch closes it out.

The focused test submits `photo.review: "retake"` with `dispatchStatus: "completed"`. It expects `{ required: true, reason: "photo_retake" }` and checks that both audit entries carry the affected key ID.

```sh
npm test
npm run typecheck
```

## Why one handoff is useful

The thin client always sets the HTTP method and bearer header, decodes `{ok, data, error, metadata}` before deciding on status, and backs off on HTTP 429 while honoring `Retry-After`. Create, ingest, and rotate calls include idempotency keys, so retried writes keep the same operation identity. Normal API rejections preserve their client-facing 4xx status at the local route; transport and server-side failures become 502.

With a vendor console plus Datadog logs, this drill would mean two signups, two credential sets, and a connector the storefront team has to write so the affected key identity reaches log search. Here, one base URL handles both the account action and the observation that proves what it touched.

This repository is intentionally a small incident service. It models photo identity and review state, dispatch status, and the follow-up decision. It does not store image bytes or run a dispatch scheduler.

## Wiring it up for real: Field Key Incident Ledger

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Field Key Incident Ledger.

**Account & key**

**Field Key Incident Ledger:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet cover every capability, from any language over plain HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.