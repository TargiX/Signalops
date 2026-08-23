# SignalOps AI Telemetry Contract v1

This directory is the portable contract artifact for SignalOps canonical AI telemetry v1.

- `event.schema.json` is the normative machine-readable schema.
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
  --valid-dir=/absolute/path/to/fixtures/valid \
  --invalid-dir=/absolute/path/to/fixtures/invalid
```

A client repository should pin these artifacts to an immutable SignalOps commit. It must not track
the moving `main` branch in CI. Publishing a package or release archive is deferred until the v1
contract is approved; until then, use the full commit SHA in the raw GitHub URL or vendor the files
with their source SHA recorded.

## Compatibility

Additive optional fields may be added to v1. Any change to lifecycle meaning, cost provenance,
failure classification, required fields, or accepted enum values requires a new contract version.
The current `/api/events` prototype is v0 and is not compatible with this schema.
