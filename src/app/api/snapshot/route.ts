import { NextResponse } from "next/server";

import { getOpsSnapshot } from "@/lib/mock-data";
import {
  hasValidCockpitSessionFromRequest,
  isCockpitAuthRequired,
  isOperatorAccessPilotReady,
  isOperatorApiTokenConfigured,
} from "@/lib/signalops/auth";
import { overlaySignalEvents } from "@/lib/signalops/snapshot";
import { getSignalOpsStore, getStoreHealth, getWorkspaceSlug } from "@/lib/signalops/store";

export const runtime = "nodejs";

const allowedRanges = new Set(["24h", "7d", "30d"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const range = url.searchParams.get("range") ?? "24h";
  const safeRange = allowedRanges.has(range) ? (range as "24h" | "7d" | "30d") : "24h";
  const snapshot = getOpsSnapshot(safeRange);
  const storage = getStoreHealth();
  const sourceOverlayProtected =
    isCockpitAuthRequired() || isOperatorApiTokenConfigured() || (storage.durable && storage.ready);
  const canReadSourceOverlay = !sourceOverlayProtected || hasValidCockpitSessionFromRequest(request);

  if (!canReadSourceOverlay) {
    return NextResponse.json(
      overlaySignalEvents(snapshot, [], {
        durableSourceStorage: false,
        sourceOnlyReportPath: `/source-report?range=${safeRange}`,
      }),
    );
  }

  if ((process.env.NODE_ENV === "production" || process.env.VERCEL) && storage.durable && storage.ready && !isOperatorAccessPilotReady()) {
    return NextResponse.json(
      overlaySignalEvents(snapshot, [], {
        durableSourceStorage: false,
        sourceOnlyReportPath: `/source-report?range=${safeRange}`,
      }),
    );
  }

  const sourceReportPath = `/source-report?range=${safeRange}`;
  const events = await getSignalOpsStore().listEvents(getWorkspaceSlug(), 500, {
    filters: { range: safeRange },
  });

  return NextResponse.json(
    overlaySignalEvents(snapshot, events, {
      durableSourceStorage: storage.durable && storage.ready,
      sourceOnlyReportPath: sourceReportPath,
    }),
  );
}
