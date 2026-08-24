# SignalOps npm package release

The packages are technically packable but must not be published until an explicit repository and
package license is chosen and committed. License selection is a product/legal decision; do not infer
one from package visibility.

## Release order

1. Choose the license and add `LICENSE` at the repository root plus matching `license` fields in both
   package manifests.
2. Run `pnpm check` and the PostgreSQL migration job.
3. Pack both packages and inspect their manifests:

   ```bash
   mkdir -p .context/package-release
   pnpm --filter @signalops/contracts pack --pack-destination .context/package-release --json
   pnpm --filter @signalops/producer-node pack --pack-destination .context/package-release --json
   ```

4. Install the tarballs in an empty Node 20 project and run the producer conformance scenario.
5. Confirm the intended versions are unused on npm and the authenticated npm account controls the
   `@signalops` scope.
6. Publish contracts first, then producer, from a clean tagged commit with npm provenance enabled.
7. Install both packages from the public registry in a fresh project and execute the README example
   against validation, then a disposable tenant ingest credential.
8. Update public docs only after registry installation and the live ingest receipt are proven.

Publishing, merging, deploying, and documenting registry availability are separate authorities and
must be reported separately.
