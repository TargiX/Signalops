import { NextResponse } from "next/server";

import { hasValidCockpitSessionFromRequest, isOperatorAccessPilotReady } from "@/lib/signalops/auth";
import {
  buildSourceOperationalReport,
  sourceOperationalReportToCsv,
  sourceOperationalReportToMarkdown,
  type SourceReportFilters,
  type SourceReportRange,
} from "@/lib/signalops/source-report";
import { getSignalOpsStore, getStoreHealth, getWorkspaceSlug } from "@/lib/signalops/store";

export const runtime = "nodejs";

function requestId() {
  return `req_${crypto.randomUUID()}`;
}

function readLimit(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("limit") ?? "500");
  if (!Number.isFinite(value)) {
    return 500;
  }

  return Math.max(1, Math.min(Math.floor(value), 1000));
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function productionOperatorAuthIsMissing() {
  return (process.env.NODE_ENV === "production" || process.env.VERCEL) && !isOperatorAccessPilotReady();
}

function readFilters(request: Request): SourceReportFilters {
  const params = new URL(request.url).searchParams;
  const range = params.get("range");
  const eventId = params.get("eventId")?.trim();
  const providerId = params.get("providerId")?.trim();
  const modelId = params.get("modelId")?.trim();

  return {
    range: range === "24h" || range === "7d" || range === "30d" || range === "all" ? (range as SourceReportRange) : "all",
    eventId: eventId || undefined,
    providerId: providerId || undefined,
    modelId: modelId || undefined,
  };
}

export async function GET(request: Request) {
  const id = requestId();
  if (productionOperatorAuthIsMissing()) {
    return NextResponse.json(
      {
        ok: false,
        code: "operator_auth_not_configured",
        error: "operator auth must be configured before reading source reports in production",
        requestId: id,
      },
      { status: 503 },
    );
  }

  if (!hasValidCockpitSessionFromRequest(request)) {
    return NextResponse.json({ ok: false, code: "cockpit_auth_required", requestId: id }, { status: 401 });
  }

  const limit = readLimit(request);
  const format = new URL(request.url).searchParams.get("format");
  const filters = readFilters(request);
  const storage = getStoreHealth();
  const workspaceSlug = getWorkspaceSlug();

  try {
    const events = await getSignalOpsStore().listEvents(workspaceSlug, limit, { filters });
    const report = buildSourceOperationalReport(events, { workspaceSlug, filters });
    if (format === "markdown") {
      return new Response(sourceOperationalReportToMarkdown(report), {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${safeFilename(workspaceSlug)}-source-report.md"`,
        },
      });
    }

    if (format === "csv") {
      return new Response(sourceOperationalReportToCsv(report), {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${safeFilename(workspaceSlug)}-source-report.csv"`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      storage,
      limit,
      filters,
      report,
      requestId: id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "source_report_failed",
        error: error instanceof Error ? error.message : "source report failed",
        storage,
        requestId: id,
      },
      { status: 500 },
    );
  }
}
