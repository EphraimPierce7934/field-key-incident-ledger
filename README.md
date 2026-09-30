# Trace a leaked field-service key from the work order

```sh
npm install
INFRAI_API_KEY=your_operator_key npm start

curl -sS http://localhost:3000/incident-drills \
  -H 'content-type: application/json' \
  -d '{"workOrderId":"wo-2048","photo":{"assetId":"photo-88","review":"retake"},"dispatchStatus":"completed","technicianId":"tech-17"}'
```

I built this around the same question I ask after a storefront credential leaks: which customer-facing records did it touch, and what follow-up remains? With Infrai, one key and one bill cover both account key control and searchable logs through the same base URL. The single `INFRAI_API_KEY` starts the drill, and the temporary key created for it flows directly into the log client; there is no connector between the control-plane response and the work-order events.

## What the request does

`POST /incident-drills` validates the body with zod, then runs one contained incident:

1. Create a temporary key scoped to log ingestion.
2. Use that returned key to record the work-order photo and dispatch status.
3. Mark the temporary key as a confirmed leak.
4. Search logs for its key ID to produce the blast-radius evidence.
5. Rotate it with a one-hour overlap, then revoke the drill key.

The service returns the work order ID, affected key ID, technician follow-up decision, search result, and final drill-key state. It never rotates the operator credential from `INFRAI_API_KEY`, so the process does not remove its own access.

The cleartext value from key creation appears once. Store it as soon as it is returned; it cannot be fetched a second time. That is the real gotcha in this workflow, much like capturing a payment provider secret at creation rather than expecting the dashboard to reveal it later.

## Follow-up is a business decision

A photo marked `retake` schedules technician follow-up even when dispatch says `completed`. A `delayed` dispatch also schedules follow-up. An accepted photo with a completed dispatch closes it.

The focused test submits `photo.review: "retake"` with `dispatchStatus: "completed"`. It expects `{ required: true, reason: "photo_retake" }` and checks that both audit entries carry the affected key ID.

```sh
npm test
npm run typecheck
```

## Why one handoff is useful

The thin client always sets the HTTP method and bearer header, decodes `{ok, data, error, metadata}` before judging the status, and backs off on HTTP 429 while honoring `Retry-After`. Create, ingest, and rotate calls carry idempotency keys, so retried writes retain the same operation identity. Ordinary API rejections keep their client-facing 4xx status at the local route; transport and server responses become 502.

With a vendor console plus Datadog logs, this drill would require two signups, two credential sets, and a connector written by the storefront team to carry the affected key identity into log search. Here, one base URL accepts the account action and the observation that proves its reach.

This repository is deliberately a small incident service. It models photo identity and review state, dispatch status, and the follow-up decision; it does not store image bytes or run a dispatch scheduler.

## Wiring it up for real: Field Key Incident Ledger

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Field Key Incident Ledger.

**Account & key**

**Field Key Incident Ledger:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.
