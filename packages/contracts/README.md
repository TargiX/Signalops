# @signalops/contracts

The versioned, framework-neutral SignalOps Canonical AI Telemetry V1 contract.

The package contains TypeScript types plus the normative JSON Schemas, portable semantic
validator, and valid/invalid fixtures. V1 is closed-world: pin an exact package version and upgrade
deliberately.

```ts
import type { SignalOpsEventV1 } from "@signalops/contracts/v1";
import eventSchema from "@signalops/contracts/v1/event.schema.json" with { type: "json" };
```

Exported artifacts:

- `@signalops/contracts/v1`
- `@signalops/contracts/v1/event.schema.json`
- `@signalops/contracts/v1/ingest-response.schema.json`
- `@signalops/contracts/v1/semantic-validation`
- `@signalops/contracts/v1/fixtures/valid/*`
- `@signalops/contracts/v1/fixtures/invalid/*`

The contract forbids prompts, media URLs, emails, user identifiers, credentials, raw provider
errors, and stack traces. A producer should emit opaque operation and attempt identifiers plus
normalized operational facts only.
