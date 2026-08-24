# SignalOps public-beta go-to-market

Status: ready to execute after deployment
Owner: founder-led until the first ten activated workspaces
North star: workspaces with a first accepted production operation and a returning operator

## Positioning

SignalOps is the privacy-safe evidence layer for teams that call multiple AI providers, retry or
fall back between them, and cannot reliably distinguish provider behavior from application behavior.
It observes lifecycle facts; it does not replace provider credentials, provider management, queues,
or customer routing logic.

Initial ICP:

- AI image, video, text, or multimodal products with at least two provider routes or meaningful
  retry/fallback behavior.
- A technical founder, platform lead, or reliability owner currently debugging from application
  logs, provider dashboards, and billing exports.
- Enough production volume that tail latency, retries, unclassified failures, or cost evidence has
  become a weekly operating problem.

Disqualifiers: a single experimental provider call, teams wanting prompt analytics, routing control
without instrumentation, or regulated workloads before commercial assurance is complete.

## Activation contract

The seven-day activation funnel is:

1. `signup_completed` — identity provider returns a stable opaque subject.
2. `workspace_created` — isolated tenant and owner membership commit.
3. `ingest_key_created` — owner receives a one-time managed credential.
4. `first_production_event_accepted` — the first new event with
   `resource.environment=production` commits durably.

Supporting intent and value signals:

- Acquisition: `home_cta_clicked`, `signup_started`, `pilot_request_submitted`.
- Onboarding: `quickstart_copied`, `first_snapshot_viewed`.
- Adoption: `cockpit_opened`, `operation_opened`, `investigation_brief_exported`.
- Credential safety: server truth for created, rotated, and revoked keys.

Never attach email, ingest secrets, prompts, media, raw operation IDs, free-form search, contact
messages, or customer telemetry to product analytics.

## First 30 users

### 1. Dogfood proof

Use Phosphene as the first generic adapter, not a special case. Publish one technical case study:

- the exact lifecycle seams;
- which fields were deliberately excluded;
- a real retry/fallback incident SignalOps made easier to explain;
- before/after time to isolate provider versus application responsibility;
- the reusable adapter and conformance boundary.

### 2. Founder-led outbound

Build a hand-curated list of 50 products where public evidence shows multi-provider AI generation,
fallbacks, or provider reliability pain. Contact only 10 per week. The message should contain one
specific observed operational risk and offer a 30-minute lifecycle mapping, not a generic demo.

Target outcome per week: 10 relevant contacts → 3 replies → 2 lifecycle calls → 1 integrated
workspace. Record only company, contact status, source, problem, next action, and activation state in
the sales tracker; never copy customer telemetry into it.

### 3. Developer acquisition

- Make the GitHub README lead with the raw HTTP quickstart and privacy contract.
- Publish one integration article per high-intent query: AI provider fallback monitoring, AI retry
  observability, provider-attempt telemetry, and privacy-safe LLM operations.
- Share the canonical schema and conformance suite where practitioners discuss observability and
  multi-provider reliability. Lead with implementation detail, not launch slogans.
- After the license decision and npm release, publish both packages and a small framework-adapter
  example. Registry publication is a distribution milestone, not the activation metric.

### 4. Product-led loop

The exported privacy-safe investigation brief is the sharing loop. Every useful handoff should link
back to a canonical incident or filtered cockpit view, while excluding operation search text and
customer content. Measure brief exports and subsequent new signup starts, but do not fingerprint
recipients.

## Weekly operating review

Open the pinned PostHog dashboard **Public Beta Activation** and answer:

1. How many external signup completions, workspaces, managed keys, and activations occurred?
2. Where did the seven-day funnel lose the most users?
3. Which acquisition action produced an activated workspace, not merely a pageview?
4. Did activated operators return to the cockpit and inspect operations?
5. Which onboarding or delivery errors blocked activation?
6. What did the last five user conversations change in the product or documentation?

Keep test accounts excluded. Until there are ten activated workspaces, inspect every lost activation
manually and fix the commonest product friction before increasing traffic.

## Launch sequence

- Phase 0: deploy migration, self-serve flag, auth redirects, lead delivery, and activation events.
- Phase 1: dogfood Phosphene end to end and record one complete seven-day funnel.
- Phase 2: invite five design partners individually; support integration synchronously.
- Phase 3: publish case study and raw HTTP quickstart; begin founder-led outbound.
- Phase 4: choose package license, publish npm packages with provenance, then add framework examples.
- Phase 5: only after repeated activation, test paid retention/volume plans and a documented support
  boundary.

## Exit criteria for public beta

- At least ten external activated workspaces and five returning weekly operators.
- Median time from workspace creation to first production signal under ten minutes.
- At least 60% of completed signups reach first production signal within seven days.
- No confirmed cross-tenant access, credential exposure, or sensitive analytics payload.
- A repeatable acquisition channel produces at least three activated workspaces without founder
  network introductions.
- Final legal entity, license, privacy, terms, support, retention, deletion, billing, and assurance
  decisions are reviewed before general availability.
