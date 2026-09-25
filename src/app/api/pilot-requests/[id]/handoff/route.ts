import { NextResponse } from "next/server";

import { hasValidCockpitSessionFromRequest, isOperatorAccessPilotReady } from "@/lib/signalops/auth";
import { buildPilotHandoffPack } from "@/lib/signalops/pilot-handoff";
import { getSignalOpsStore, getStoreHealth } from "@/lib/signalops/store";

export const runtime = "nodejs";

function requestId() {
  return `req_${crypto.randomUUID()}`;
}

function productionOperatorAuthIsMissing() {
  return (process.env.NODE_ENV === "production" || process.env.VERCEL) && !isOperatorAccessPilotReady();
}

function assertOperatorAccess(request: Request, id: string) {
  if (productionOperatorAuthIsMissing()) {
    return NextResponse.json(
      {
        ok: false,
        code: "operator_auth_not_configured",
        error: "operator auth must be configured before reading pilot handoff packs in production",
        requestId: id,
      },
      { status: 503 },
    );
  }

  if (!hasValidCockpitSessionFromRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        code: "unauthorized",
        error: "operator session required",
        requestId: id,
      },
      { status: 401 },
    );
  }

  return null;
}

function markdownFilename(pilotRequestId: string) {
  return `${pilotRequestId.replace(/[^a-zA-Z0-9_-]/g, "-")}-signalops-handoff.md`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = requestId();
  const authError = assertOperatorAccess(request, id);
  if (authError) {
    return authError;
  }

  const { id: pilotRequestId } = await params;
  const url = new URL(request.url);
  const baseUrl = process.env.SIGNALOPS_PUBLIC_BASE_URL || process.env.SIGNALOPS_BASE_URL || url.origin;
  const storage = getStoreHealth();

  try {
    const requests = await getSignalOpsStore().listPilotRequests(100);
    const pilotRequest = requests.find((item) => item.id === pilotRequestId);
    if (!pilotRequest) {
      return NextResponse.json(
        {
          ok: false,
          code: "pilot_request_not_found",
          error: "pilot request was not found",
          storage,
          requestId: id,
        },
        { status: 404 },
      );
    }

    const handoff = buildPilotHandoffPack(pilotRequest, { baseUrl });
    if (url.searchParams.get("format") === "markdown") {
      return new Response(handoff.markdown, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${markdownFilename(pilotRequest.id)}"`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      storage,
      handoff,
      requestId: id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "pilot_handoff_failed",
        error: error instanceof Error ? error.message : "pilot handoff failed",
        storage,
        requestId: id,
      },
      { status: 500 },
    );
  }
}
