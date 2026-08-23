import eventSchema from "../../../../../schemas/ai-telemetry/v1/event.schema.json" with { type: "json" };

export const dynamic = "force-static";

export function GET() {
  return Response.json(eventSchema, {
    headers: {
      "cache-control": "public, max-age=3600, s-maxage=86400, immutable",
      "content-type": "application/schema+json",
    },
  });
}
