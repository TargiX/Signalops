# SignalOps Operations Runbook

This runbook covers the production data plane only: tenant bootstrap, operator access, ingest
credentials, logical backup/restore drills, and deterministic projection rebuilds. It does not
authorize a deploy, a production database restore, an email invitation, or a consumer secret
change. Those remain separate operator decisions.

## Safety invariants

- Use a dedicated SignalOps Supabase project. Never point these commands at Roomboard, Anchor, or a
  customer application database.
- Read `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from an approved secret source. Never pass a service
  key as a command-line flag, commit it, paste it into a ticket, or leave it in shell history.
- Every command requires `--project-ref`; the CLI rejects any URL except the exact
  `https://<project-ref>.supabase.co` target.
- Every mutation also requires the same value in `--confirm-project-ref` plus an explicit opaque
  `--actor-subject`. Mutations are written to `signalops_v1_audit_log`.
- Tenant IDs, auth subjects, and credential IDs are always supplied explicitly. There is no
  "current tenant", first-row, wildcard, or all-tenants mutation default.
- Serialize mutations for the same tenant. Do not run two bootstrap, membership, credential, or
  projection commands concurrently.
- The service-role key bypasses RLS. Run the CLI only from an approved administrative workstation
  or controlled job, never from the browser or public application runtime.
- Raw ingest tokens are never stored by SignalOps. Create and rotate print a raw token exactly once;
  only its SHA-256 digest and a non-secret prefix are persisted.

The CLI help is the current command authority:

```bash
node scripts/signalops-admin.mjs --help
```

Before any mutation, prove the target with a read:

```bash
node scripts/signalops-admin.mjs tenant list \
  --project-ref "$SIGNALOPS_PROJECT_REF"
```

Stop if the printed project reference or tenant inventory is unexpected.

## Apply and verify migrations

1. Link the Supabase CLI to the dedicated SignalOps project and independently verify the project
   reference in the dashboard and CLI output.
2. Review the pending migration diff. Apply committed migrations through the normal deployment
   workflow; do not paste ad hoc SQL into production.
3. Run Supabase security and performance advisors after migration.
4. Verify that `anon` and `authenticated` have no table access to `signalops_v1_*`; application
   access must go through server-side adapters.
5. Run the repository's Postgres adapter, cross-tenant isolation, and contract suites before
   onboarding a tenant.

Migration application and application deployment are separate gates. A successful migration does
not prove the new application is deployed, and a deployed application does not prove the migration
was applied.

## Bootstrap a tenant

Bootstrap is insert-only and idempotent for an exact active tenant. It refuses to rename, reactivate,
or overwrite an existing tenant.

```bash
node scripts/signalops-admin.mjs tenant bootstrap \
  --project-ref "$SIGNALOPS_PROJECT_REF" \
  --confirm-project-ref "$SIGNALOPS_PROJECT_REF" \
  --actor-subject "$SIGNALOPS_ADMIN_SUBJECT" \
  --tenant-id phosphene-production \
  --tenant-name "Phosphene Production"
```

Run `tenant list` again and verify the exact ID, display name, and `active` state before creating
credentials or memberships.

## Invite an operator and grant membership

Membership is keyed by the stable Supabase Auth subject, never by email. If the user already exists,
copy the user UUID from the trusted Supabase Auth admin view and grant membership directly:

```bash
node scripts/signalops-admin.mjs membership grant \
  --project-ref "$SIGNALOPS_PROJECT_REF" \
  --confirm-project-ref "$SIGNALOPS_PROJECT_REF" \
  --actor-subject "$SIGNALOPS_ADMIN_SUBJECT" \
  --tenant-id phosphene-production \
  --subject 70ea64ef-445a-45b4-b12b-c67bc7d758fd \
  --role owner
```

Changing an existing role is refused unless `--replace-role` is present. Confirm the old and new
roles out of band before using that flag.

Sending an invitation is a distinct external side effect. It happens only with `--send-invite`:

```bash
node scripts/signalops-admin.mjs auth invite \
  --project-ref "$SIGNALOPS_PROJECT_REF" \
  --confirm-project-ref "$SIGNALOPS_PROJECT_REF" \
  --actor-subject "$SIGNALOPS_ADMIN_SUBJECT" \
  --email operator@example.com \
  --send-invite \
  --redirect-to https://signalops.example.com/api/cockpit/auth/callback
```

The command prints the returned auth subject but does not silently grant access. Use that subject in
a separate `membership grant` command, then verify with:

```bash
node scripts/signalops-admin.mjs membership list \
  --project-ref "$SIGNALOPS_PROJECT_REF" \
  --tenant-id phosphene-production
```

SignalOps does not store the invite email in its tenant tables or audit metadata. Email delivery,
redirect allowlists, OAuth providers, and SMTP configuration must already be verified in Supabase.

## Create an ingest credential

Choose an explicit expiry, or consciously opt into a non-expiring credential with `--no-expiry`.
Prefer expiry for production credentials.

```bash
node scripts/signalops-admin.mjs credential create \
  --project-ref "$SIGNALOPS_PROJECT_REF" \
  --confirm-project-ref "$SIGNALOPS_PROJECT_REF" \
  --actor-subject "$SIGNALOPS_ADMIN_SUBJECT" \
  --tenant-id phosphene-production \
  --name phosphene-prod-2026-08 \
  --scopes events:validate,events:write \
  --expires-at 2026-11-23T00:00:00Z
```

The `credential_token=...` line is the only copy SignalOps will show. Run the command outside screen
sharing and CI logs, transfer that value directly into the approved consumer secret store, and
clear the terminal scrollback according to workstation policy. Never put it in a dotenv file that
will be committed. If the token is lost before installation, revoke the credential and create a new
one; hashes cannot recover it.

Verify metadata without exposing either the token or its hash:

```bash
node scripts/signalops-admin.mjs credential list \
  --project-ref "$SIGNALOPS_PROJECT_REF" \
  --tenant-id phosphene-production
```

## Two-phase credential rotation

Rotation deliberately keeps the previous credential active. This prevents an administrative
command from creating an unplanned producer outage.

1. Record the old credential UUID from `credential list`.
2. Create one linked replacement. `--confirm-rotate` must repeat the old UUID:

   ```bash
   node scripts/signalops-admin.mjs credential rotate \
     --project-ref "$SIGNALOPS_PROJECT_REF" \
     --confirm-project-ref "$SIGNALOPS_PROJECT_REF" \
     --actor-subject "$SIGNALOPS_ADMIN_SUBJECT" \
     --tenant-id phosphene-production \
     --credential-id 11111111-1111-4111-8111-111111111111 \
     --confirm-rotate 11111111-1111-4111-8111-111111111111 \
     --name phosphene-prod-2026-11 \
     --expires-at 2027-02-23T00:00:00Z
   ```

3. Install the one-time replacement token in the Phosphene deployment secret store through its
   authorized release workflow.
4. Verify fresh successful deliveries and confirm the replacement credential's `last_used_at`
   advances. Keep the old credential active for at least the producer's maximum retry/backoff window.
5. Roll back the producer secret if verification fails. Do not revoke the old credential.
6. Only after verification, revoke the exact old credential with a second explicit mutation:

   ```bash
   node scripts/signalops-admin.mjs credential revoke \
     --project-ref "$SIGNALOPS_PROJECT_REF" \
     --confirm-project-ref "$SIGNALOPS_PROJECT_REF" \
     --actor-subject "$SIGNALOPS_ADMIN_SUBJECT" \
     --tenant-id phosphene-production \
     --credential-id 11111111-1111-4111-8111-111111111111 \
     --confirm-revoke 11111111-1111-4111-8111-111111111111
   ```

7. Verify the old row now has `revoked_at`, the replacement remains active, and delivery continues.

If a credential is suspected compromised, shorten the overlap according to incident severity, but
still create and install a replacement before revoking whenever availability permits.

## Backup

Supabase managed backups and point-in-time recovery are the production recovery authority. A
logical application-data export is an additional portability and restore-test artifact, not a
replacement for managed backups.

Before every release that changes persistence, and at the scheduled recovery-test cadence:

1. Verify managed backup/PITR status and retention in the dedicated project's dashboard.
2. Record the project reference, database migration version, application commit, UTC timestamp, and
   operator in the change record.
3. Create an encrypted logical archive of `public.signalops_v1_*` using `pg_dump` from a controlled
   runner. Supply the database URL through `PGDATABASE`, not a command-line argument:

   ```bash
   SIGNALOPS_BACKUP_DIR="$(mktemp -d -t signalops-backup)"
   SIGNALOPS_BACKUP_FILE="$SIGNALOPS_BACKUP_DIR/signalops-data.dump"
   PGDATABASE="$SIGNALOPS_DATABASE_URL" pg_dump \
     --format=custom \
     --compress=9 \
     --no-owner \
     --no-acl \
     --data-only \
     --table='public.signalops_v1_*' \
     --file="$SIGNALOPS_BACKUP_FILE"
   pg_restore --list "$SIGNALOPS_BACKUP_FILE" > "$SIGNALOPS_BACKUP_FILE.list"
   shasum -a 256 "$SIGNALOPS_BACKUP_FILE" > "$SIGNALOPS_BACKUP_FILE.sha256"
   ```

4. Check that the archive list contains every expected SignalOps table and no unrelated schema.
5. Move the archive, list, and checksum to the approved encrypted backup store with restricted
   access and retention. Do not commit them or leave them in a shared temporary directory.
6. Verify restoreability in an isolated project; archive creation alone is not a successful backup
   drill.

Because the logical archive contains credential hashes, auth subjects, and operational data, treat
it as confidential even though raw API tokens, prompts, media, and emails are absent by contract.

## Restore drill

Never test a restore against production. Use a new, isolated Supabase project with outbound alerts,
cron evaluation, and producer traffic disabled.

1. Obtain incident/change approval and record source and destination project references. A second
   operator verifies that the destination is not production.
2. Apply the same committed migrations to the empty destination.
3. Verify the archive checksum and inspect `pg_restore --list` before mutation.
4. Restore in one transaction:

   ```bash
   PGDATABASE="$SIGNALOPS_RESTORE_DATABASE_URL" pg_restore \
     --exit-on-error \
     --single-transaction \
     --no-owner \
     --no-acl \
     --data-only \
     "$SIGNALOPS_BACKUP_FILE"
   ```

5. Compare per-table row counts, per-tenant event counts, newest `received_at`, open incident
   fingerprints, and projection source counts with the source receipt.
6. Keep alert webhooks and cron disabled. Create a dedicated drill operator rather than restoring or
   reusing a production login flow.
7. Run the contract, tenant-isolation, snapshot, and incident evaluation checks against the restored
   project.
8. Perform a clean projection rebuild and compare deterministic snapshot totals and incident
   fingerprints.
9. Record recovery point and recovery time. A drill is failed if counts, fingerprints, or privacy
   invariants differ, even when `pg_restore` exits zero.
10. Destroy the isolated project through the separately approved provider workflow and verify the
    confidential local archive is removed according to retention policy.

An actual production restore additionally requires an incident commander, an ingest freeze or
maintenance plan, a fresh pre-restore backup, explicit rollback criteria, customer-impact
communication, and post-restore credential rotation. This runbook alone does not authorize it.

## Projection rebuild

Canonical events are the source of truth. The admin command invalidates only materialized snapshot
rows; it never deletes canonical events. The next request for an invalidated range rebuilds it from
the append-only event store. `all` also clears the shared `ops-snapshot-v1` checkpoint.

1. Confirm ingest is healthy and note the current snapshot watermark, source event count, totals,
   data-quality conflict count, and open incident fingerprints for each affected range.
2. Take or verify a current backup. Pause if event volume exceeds the documented bounded rebuild
   capacity.
3. Invalidate exactly one range first:

   ```bash
   node scripts/signalops-admin.mjs projection rebuild \
     --project-ref "$SIGNALOPS_PROJECT_REF" \
     --confirm-project-ref "$SIGNALOPS_PROJECT_REF" \
     --actor-subject "$SIGNALOPS_ADMIN_SUBJECT" \
     --tenant-id phosphene-production \
     --range 7d \
     --confirm-rebuild phosphene-production
   ```

4. Request that range from the authenticated cockpit. Verify that `projectedAt` advances, freshness
   returns within the SLO, source count/watermark match the canonical store, totals are deterministic,
   and incident fingerprints do not churn.
5. If validation succeeds, repeat for other ranges or use `--range all`. If it fails, preserve the
   evidence, stop further invalidations, and investigate the projector; accepted events remain
   intact.
6. Confirm the `projection.invalidate` audit event and monitor projection lag and error alerts until
   all ranges are healthy.

Do not delete or rewrite `signalops_v1_events` to repair a projection. Corrections are new canonical
events or an explicitly reviewed data migration.

## Retention and recurring drills

The v1 operational retention policy is:

- raw canonical events: 100 days, preserving the full 90-day cockpit range plus processing margin;
- telemetry conflicts and audit records: 400 days;
- rate-limit buckets: 2 days.

There is no durable historical aggregate tier yet, so do not promise or report 13-month aggregate
history. Before production traffic, configure and test the scheduled retention implementation,
disclose the effective policy to the tenant, and alert on job failure. Never improvise a manual
wildcard delete as retention.

At minimum, schedule and retain evidence for:

- quarterly credential rotation;
- regular isolated restore drills with measured RPO/RTO;
- projection rebuild parity after projector changes;
- periodic membership and service-key access reviews;
- alert-delivery and ingest-failure exercises;
- Supabase advisor review after schema or policy changes.
