# SignalOps Public Beta Activation v1

Status: implemented; deployment and production configuration pending
Last updated: 2026-08-24

## Outcome

A new team can discover SignalOps, create an account and isolated workspace, issue a revocable
ingest credential, send canonical telemetry, and see the first production operation in the live
cockpit without an administrator touching the customer application or SignalOps database.

The activation promise is:

> First privacy-safe production signal visible in under ten minutes.

Phosphene remains the first dogfood tenant, never a schema or onboarding special case.

## Public-beta activation path

1. Anonymous visitor opens a real product, docs, pricing, security, or contact route.
2. Visitor starts signup with email OTP or an allowlisted OAuth provider.
3. Authenticated subject creates one initial workspace. Tenant and owner membership are committed
   atomically and every retry resolves to the same active membership.
4. The owner creates a scoped ingest credential. The raw token is returned exactly once; only its
   SHA-256 digest and non-secret prefix are stored.
5. The onboarding surface provides raw HTTP and Node.js quickstarts against Canonical AI Telemetry
   V1. Credentials remain server-only in customer applications.
6. The first accepted event whose canonical environment is `production` claims a durable activation
   milestone and becomes visible in the live cockpit.

## Security invariants

- Public signup is an explicit production feature flag and also requires configured Supabase Auth,
  durable Supabase storage, and server-only administrative credentials.
- Every mutation is same-origin, rate-limited, authenticated, authorized near the data source, and
  written to the audit log without email addresses, prompts, media, tokens, or raw errors.
- Self-serve workspace provisioning is serialized by authenticated subject and is idempotent.
- Credential create, rotation, and revocation require an active owner membership.
- Browser roles retain zero direct access to `signalops_v1_*` tables and RPCs.
- PostHog receives SaaS behavior only: opaque auth subject, workspace group, integration choice,
  and bounded action metadata. Canonical customer telemetry stays in SignalOps.

## Product analytics contract

Server-truth events:

- `signup_completed`
- `workspace_created`
- `ingest_key_created`
- `ingest_key_rotated`
- `ingest_key_revoked`
- `first_production_event_accepted`

Client action events:

- `signup_started`
- `quickstart_copied`
- `first_snapshot_viewed`
- `cockpit_opened`
- `operation_opened`
- `investigation_brief_exported`

Authenticated browser events use the stable Supabase subject as `distinct_id` and the canonical
tenant ID as PostHog's `workspace` group. Raw operation IDs and free-form search text are excluded.

## Launch gates

- Public navigation has no dead links or unverified customer claims.
- Raw HTTP quickstart works independently of npm publication.
- Package tarballs build reproducibly; public npm release remains a separate authorized action.
- Signup, workspace provisioning, key lifecycle, first ingest, logout, and tenant isolation have
  focused regression coverage.
- Production readiness reports whether public signup is deliberately enabled, without making a
  private installation unhealthy.
