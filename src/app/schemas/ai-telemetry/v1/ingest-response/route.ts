import ingestResponseSchema from "../../../../../../schemas/ai-telemetry/v1/ingest-response.schema.json" with { type: "json" };

export const dynamic = "force-static";

export function GET() {
  return Response.json(ingestResponseSchema, {
    headers: {
      "cache-control": "public, max-age=3600, s-maxage=86400, immutable",
      "content-disposition": "inline; filename=signalops-ai-telemetry-v1-ingest-response.schema.json",
      "content-type": "application/schema+json",
    },
  });
}
