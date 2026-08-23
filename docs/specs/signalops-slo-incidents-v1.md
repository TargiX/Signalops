# SignalOps SLO and incident workflow V1

Status: implementation contract
Date: 2026-08-24
Scope: observation and operator ownership only

## Outcome

SignalOps evaluates tenant reliability using explicit, versioned policies. A failed objective opens
one stable incident per tenant, metric, route scope, and policy version. Operators can acknowledge
ownership; only the evaluator can resolve or reopen an incident from observed evidence.

SignalOps does not reroute traffic, pause a provider, or mutate a customer workload in V1.

## Default objectives

| Policy | Objective | Warning | Critical | Minimum sample | Default |
| --- | ---: | ---: | ---: | ---: | --- |
| Operation reliability | >= 99% | < 98% | < 95% | 20 terminal operations | enabled |
| Operation p95 latency | <= 60s | > 120s | > 300s | 20 measured durations | enabled |
| Provider attempt coverage | >= 95% | < 90% | < 75% | 20 operations | enabled |
| Failure classification coverage | >= 95% | < 90% | < 75% | 5 failed operations | enabled |
| Signal freshness | <= 5m | > 15m | > 60m | first received signal | disabled |

Signal freshness is disabled by default because silence is not an outage until a tenant declares an
expected traffic cadence. A policy below its minimum sample is `insufficient_data`; it never opens
an incident.

Latency sample size counts only operations with measured or derivable durations. Catalog prices,
logical model labels, and inferred provider routes are never used as evidence for these policies.

## Tenant configuration

Defaults are materialized for existing active tenants and remain available as code defaults for new
tenants. An owner can change thresholds, minimum sample, or enabled state through `PATCH /v1/slos`.
Every change creates a new policy version and an audit event. Comparator, metric, and evaluation
window are not mutable in V1, preventing a configuration label from diverging from the projector.

All SLO reads and writes require an operator session. Policy changes require the `owner` role,
same-origin validation, bounded JSON, and a tenant-scoped rate limit.

## Incident lifecycle

```text
insufficient/met -> open -> acknowledged -> resolved
                      ^          |             |
                      |          +-------------+
                      +----------- reopened ---+
```

- `opened`: a policy first breaches.
- `escalated` or `deescalated`: severity changes without changing the fingerprint.
- `acknowledged`: an owner or operator accepts ownership; repeated evaluation preserves it.
- `unacknowledged`: ownership is returned to the active queue.
- `resolved`: the evaluator no longer observes the breach.
- `reopened`: a resolved fingerprint breaches again; old acknowledgement metadata is cleared.

Transitions are append-only, tenant scoped, and include the actor, before/after state and severity,
alert revision, timestamp, and bounded evidence. Incident webhook delivery remains keyed by incident
and alert revision; acknowledgement does not create an external alert revision.

## Operator API

- `GET /v1/slos` returns policies and their current 24-hour evaluations.
- `PATCH /v1/slos` changes one built-in tenant policy and returns a fresh evaluation.
- `GET /v1/incidents?state=active` returns open and acknowledged incidents.
- `GET /v1/incidents/:id` returns the incident plus append-only lifecycle history.
- `PATCH /v1/incidents/:id` accepts `acknowledge` or `unacknowledge` for owner/operator roles.

The live cockpit shows all SLO states, including disabled and insufficient-data states, and links an
active incident to its real tenant-scoped detail route. Synthetic incident control-plane pages stay
isolated to known demo identifiers.

## Storage and release order

The additive migration creates tenant SLO policy and incident transition tables, expands incident
state with `acknowledged`, and adds acknowledgement fields. Both new tables enable RLS, deny
`anon`/`authenticated` access, and grant only the server-side service role.

Release order:

1. Apply and verify the additive database migration.
2. Deploy the compatible application.
3. Run the authenticated cockpit and incident-detail smoke checks.
4. Invoke the evaluator and confirm transition/webhook health.

Rollback may restore the previous application while leaving the additive tables and nullable
columns in place. Do not remove incident history during rollback.

## Acceptance gates

- Low-volume samples cannot open reliability or coverage incidents.
- Incident fingerprints are stable across repeated evaluations of the same policy version.
- Acknowledged incidents remain active and owned until evidence recovers.
- Recovery resolves both open and acknowledged incidents; recurrence reopens them unowned.
- Viewers cannot mutate incidents; operators cannot mutate SLO policy.
- Every operator mutation passes same-origin, body-size, role, rate-limit, and audit boundaries.
- Raw prompts, media, customer identity, credentials, raw provider errors, and stacks remain absent.
- PostgreSQL 16 migration, RLS privileges, behavioral tests, lint, typecheck, build, and production
  browser verification pass before the increment is called live.
