import { cp, mkdir } from "node:fs/promises";

const source = new URL("../../../schemas/ai-telemetry/v1/", import.meta.url);
const destination = new URL("../dist/artifacts/", import.meta.url);

await mkdir(destination, { recursive: true });
for (const name of [
  "event.schema.json",
  "ingest-response.schema.json",
  "semantic-validation.mjs",
  "fixtures",
]) {
  await cp(new URL(name, source), new URL(name, destination), {
    recursive: true,
    force: true,
  });
}
