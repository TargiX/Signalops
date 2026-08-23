# SignalOps AI Telemetry Contract v1

This directory is the portable contract artifact for SignalOps canonical AI telemetry v1.

- `event.schema.json` is the normative machine-readable schema.
- `semantic-validation.mjs` enforces portable cross-field invariants that JSON Schema draft
  2020-12 cannot express, including exact `subject` identity.
- `fixtures/valid` contains one accepted fixture for every v1 event type.
- `fixtures/invalid` contains contract, privacy, money, lifecycle, and subject failures.
- [`docs/specs/canonical-ai-telemetry-v1.md`](../../../docs/specs/canonical-ai-telemetry-v1.md)
  defines the semantics that cannot be expressed by JSON Schema alone.

## Validate this repository

```bash
pnpm contract:validate
pnpm test:contract:v1
```

## Validate a vendored contract copy

The runner imports only Node.js, Ajv, and the paths passed on the command line. It does not import
the SignalOps application implementation:

```bash
node scripts/validate-signalops-contract.mjs \
  --schema=/absolute/path/to/event.schema.json \
  --semantics=/absolute/path/to/semantic-validation.mjs \
  --valid-dir=/absolute/path/to/fixtures/valid \
  --invalid-dir=/absolute/path/to/fixtures/invalid
```

A client repository should pin the schema, semantic validator, and fixtures to an immutable
SignalOps commit. It must not track
the moving `main` branch in CI. Publishing a package or release archive is deferred until the v1
contract is approved; until then, use the full commit SHA in the raw GitHub URL or vendor the files
with their source SHA recorded.

## Compatibility

V1 is a closed-world contract: adding, removing, or renaming a field changes the accepted instance
set and requires a new contract version. The same applies to changes in lifecycle meaning, cost
provenance, failure classification, required fields, or accepted enum values. Documentation and
fixture clarifications may ship within v1 only when they do not change the accepted instance set.
The current `/api/events` prototype is v0 and is not compatible with this schema.
