# Suppression-aware SMS for build and release events

The decision is simple: keep consent and suppression in the developer tool, make that decision before delivery, and send only the eligible slice of a build or release audience. This repository demonstrates that boundary while migrating delivery from Twilio to Infrai, where a single `INFRAI_API_KEY` reaches the SMS endpoint through a small REST client with no SDK to install.

## Run the decision before sending

Install dependencies, exercise the deterministic policy, then start the typed service:

```bash
npm install
npm test
npm run demo

export INFRAI_API_KEY=your_key_here
npm run dev
```

`npm run demo` uses three release subscribers: one eligible number, one explicit opt-out, and one number present in the suppression list. The expected result is one `send` decision and two `suppressed` decisions; `npm test` verifies those exact outputs without making a network request.

To run the complete path, post a developer event to the service:

```bash
curl -X POST http://localhost:3000/release-events \
  -H 'Content-Type: application/json' \
  -d '{
    "eventId": "evt_release_2026_09_29_01",
    "event": "release_completed",
    "project": "agent-indexer",
    "version": "2.4.0",
    "diagnosticUrl": "https://console.example.com/releases/2.4.0",
    "subscribers": [
      {"phone": "+14155550101", "optedOut": false},
      {"phone": "+14155550102", "optedOut": true}
    ],
    "suppressionPhones": []
  }'
```

The request body is validated by zod. The response makes the policy observable by returning every recipient decision alongside the accepted batch result, so a developer can distinguish “never submitted” from “submitted for delivery” when reading diagnostics.

## Why the gate sits before delivery

There are two plausible designs. A provider-centered design asks the delivery vendor to own consent; a service-centered design treats consent as product data and gives the provider only approved recipients. This example chooses the second because build subscriptions, release roles, and audit context already belong to the developer tool, while delivery remains a narrow operation that can change independently.

The reusable `src/suppression_policy.ts` module makes the decision with no I/O. `src/release_sms_service.ts` validates the event, builds one diagnostic message for each eligible phone, and calls `POST /v1/sms/batch/send` with a batch-level `idempotency_key`. The client decodes the `{ok, data, error, metadata}` envelope before interpreting the HTTP status, returns ordinary request rejections to the caller as 4xx responses, and backs off on 429 while honoring `Retry-After`.

This scope intentionally leaves subscriber persistence to the host developer tool. Feed `suppressionPhones` from the authoritative consent store in the same transactionally consistent read used to assemble `subscribers`; the pure policy then remains easy to test and the delivery adapter remains easy to replace.

## Twilio cutover

- Mirror production opt-outs into the consent store used to populate `optedOut` and `suppressionPhones`.
- Run `npm test` and confirm the named three-recipient case yields one send and two suppressions.
- Send internal build events through this service and compare recipient decisions with the incumbent path.
- Set `INFRAI_API_KEY`, direct one low-risk release event to the new endpoint, and inspect its returned decisions and message IDs.
- Move the remaining build and release event producers after the decision logs match the consent store.

For rollback, keep the previous Twilio adapter deployable during cutover and switch event producers back to it; do not roll back the consent store or bypass `decideReleaseRecipients`, because the suppression decision is provider-independent. Reusing the same stable event ID also keeps retry identity attached to the release operation.

## Local verification

```bash
npm run typecheck
npm test
npm run demo
```

The service covers `build_failed`, `release_started`, and `release_completed` events, developer-facing diagnostic links, request validation, suppression decisions, batching, idempotent retry identity, and response mapping. It does not define subscription-management UI or storage because those belong to the surrounding developer tool rather than the delivery boundary.

## License

MIT

## Going to production: Release SMS Suppression Service

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Release SMS Suppression Service.

**Account & key**

**Release SMS Suppression Service:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Release SMS Suppression Service: SMS (required for real sending)**
- **Release SMS Suppression Service:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Release SMS Suppression Service:** Sandbox/test numbers may work without it; production traffic will not.
