import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  pageSource,
  liveSource,
  dashboardSource,
  chartSource,
  snapshotSource,
  projectionSource,
  cockpitViewSource,
  liveIncidentSource,
  incidentPageSource,
  sloSource,
  commandPaletteSource,
  windowPulseSource,
] = await Promise.all([
  readFile(new URL("../src/app/cockpit/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/live-cockpit.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/dashboard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/charts.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/signalops/v1/ops-snapshot.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../src/lib/signalops/v1/projection-repository.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/lib/signalops/v1/cockpit-view.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/components/live-incident-detail.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/incidents/[id]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/signalops/v1/slo.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/cockpit-command-palette.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/cockpit-window-pulse.tsx", import.meta.url), "utf8"),
]);

assert.match(
  pageSource,
  /params\.mode === "demo" \? <Dashboard \/> : <LiveCockpit \/>/,
  "Expected demo and authenticated live data loaders to remain explicitly separated.",
);

const charts = [
  "ThroughputChart",
  "LatencyChart",
  "SpendDonutChart",
  "PerformanceScatterChart",
  "TrafficAreaChart",
];
for (const chart of charts) {
  assert.match(dashboardSource, new RegExp(`<${chart}\\b`), `Expected demo to retain ${chart}.`);
  assert.match(liveSource, new RegExp(`<${chart}\\b`), `Expected live cockpit to render ${chart}.`);
}

assert.doesNotMatch(
  chartSource,
  /@\/lib\/mock-data/,
  "Shared chart primitives must not depend on the synthetic demo adapter.",
);
assert.match(
  chartSource,
  /useReducedMotion/,
  "Live chart motion must respect the operator's reduced-motion preference.",
);
assert.match(
  chartSource,
  /tickFormatter=\{\(value\) => formatFailureRate\(value, 0\)\}/,
  "Provider failure-rate axes must not render raw floating-point percentages.",
);
assert.match(
  chartSource,
  /data=\{\[chartProviderDatum\(entry\)\]\}/,
  "Shared provider chart data must not leak reusable route IDs into duplicate SVG ids.",
);
assert.match(snapshotSource, /timeline: SignalOpsTimelineBucketV1\[\]/);
assert.match(snapshotSource, /models: SignalOpsModelSnapshotV1\[\]/);
assert.match(projectionSource, /Array\.isArray\(row\.snapshot\?\.timeline\)/);
assert.match(projectionSource, /Array\.isArray\(row\.snapshot\?\.models\)/);
assert.match(projectionSource, /Array\.isArray\(row\.snapshot\?\.recentFailedOperations\)/);
assert.match(projectionSource, /operationsWithAttemptTelemetry/);
assert.match(projectionSource, /operationsWithDuration/);
assert.match(projectionSource, /row\.snapshot\?\.coverage\?\.attemptLifecycle/);
assert.match(projectionSource, /Array\.isArray\(row\.snapshot\?\.failureBreakdown\)/);
assert.match(liveSource, /insufficient live provider data/i);
assert.match(
  liveSource,
  /const spendProviderData: ChartProvider\[\] = snapshot\.providers/,
  "Spend distribution must not disappear when cost exists without latency.",
);
assert.match(
  liveSource,
  /function Panel[\s\S]*?className="min-w-0 rounded-xl/,
  "Live chart panels must be allowed to shrink instead of forcing mobile overflow.",
);
assert.equal(
  liveSource.match(/timeZone:\s*"UTC"/g)?.length,
  4,
  "Every live timeline and absolute operation formatter must render canonical timestamps in UTC.",
);
assert.doesNotMatch(
  liveSource,
  /Phosphene|customer email|Apply routing rule/i,
  "The reusable live cockpit must not hard-code its first tenant or demo-only controls.",
);
assert.match(liveSource, /const MODEL_PAGE_SIZE = 5/);
assert.match(liveSource, /const DEFAULT_OPERATION_PAGE_SIZE = 10/);
assert.match(liveSource, /const OPERATION_PAGE_SIZE_OPTIONS = \[10, 25, 50\]/);
assert.match(
  liveSource,
  /activateOperationFilter\("failed"\)/,
  "The failure KPI must open a real failed-operations view.",
);
assert.match(liveSource, /snapshot\.recentFailedOperations/);
assert.match(liveSource, /snapshot\.totals\.operationsWithAttemptTelemetry/);
assert.match(liveSource, /retryable attempts · inspect/);
assert.match(liveSource, /Instrumentation quality/);
assert.match(liveSource, /Failure intelligence/);
assert.match(liveSource, /openOperationTrace/);
assert.match(liveSource, /OperationTraceDrawer/);
assert.match(liveSource, /Inspect operation/);
assert.match(liveSource, /Search ID, model, service, failure/);
assert.match(liveSource, /Attention first/);
assert.match(liveSource, /focusModelOperations/);
assert.match(liveSource, /focusFailureOperations/);
assert.match(liveSource, /Copy operation ID/);
assert.match(liveSource, /Copy view/);
assert.match(liveSource, /downloadOperationsCsv/);
assert.match(liveSource, /Pause auto-refresh/);
assert.match(liveSource, /Keyboard shortcuts/);
assert.match(liveSource, /Skip to operations/);
assert.match(
  liveSource,
  /document\.visibilityState !== "visible"/,
  "Background tabs must not keep polling the live snapshot.",
);
assert.match(
  liveSource,
  /grid[^"]*items-start[^"]*lg:grid-cols/,
  "Provider and model panels must size to their own content instead of stretching together.",
);
assert.match(liveSource, /ariaLabel="Model performance pagination"/);
assert.match(liveSource, /ariaLabel="Operations pagination"/);
assert.doesNotMatch(
  liveSource,
  /setState\("loading"\);\s*setSelectedOperationId\(null\);\s*setOperationPage\(1\);\s*setModelPage\(1\);\s*setProviderPage\(1\);\s*setRange\(value\)/,
  "Changing the analysis range must not replace the mounted cockpit with a full-screen loader.",
);
assert.match(
  liveSource,
  /aria-label="Analysis controls"[\s\S]*?sticky/,
  "The live cockpit must keep a compact analysis control surface available while scrolling.",
);
assert.match(
  liveSource,
  /min-w-0 flex-1 overflow-x-auto/,
  "Secondary sticky controls must scroll independently so the date window stays pinned.",
);
assert.match(
  liveSource,
  /new AbortController\(\)/,
  "Range and refresh requests must cancel obsolete work instead of racing stale snapshots into view.",
);
assert.match(
  liveSource,
  /aria-live="polite"/,
  "Background refresh progress and failures must be announced without replacing the dashboard.",
);
assert.match(liveSource, /Reliability objectives/);
assert.match(liveSource, /\/v1\/incidents\?state=active/);
assert.match(liveSource, /\/v1\/slos/);
assert.match(liveSource, /href=\{`\/incidents\/\$\{encodeURIComponent\(incident\.id\)\}`\}/);
assert.match(liveIncidentSource, /Measured evidence/);
assert.match(liveIncidentSource, /Incident ownership/);
assert.match(liveIncidentSource, /Lifecycle history/);
assert.match(liveIncidentSource, /method: "PATCH"/);
assert.match(incidentPageSource, /demoIncident \? \(/);
assert.match(incidentPageSource, /<LiveIncidentDetail incidentId=\{id\}/);
assert.match(sloSource, /minimumSample: 20/);
assert.match(sloSource, /status: "insufficient_data"/);
assert.match(
  liveSource,
  /ref=\{operationSectionRef\}[\s\S]*?className="[^"]*min-w-0[^"]*scroll-mt-24/,
  "The horizontally scrollable operations table must not widen the page grid on mobile.",
);
assert.match(liveSource, /const AUTO_REFRESH_OPTIONS = \[10, 30, 60\]/);
assert.match(liveSource, /navigator\.onLine/);
assert.match(liveSource, /window\.addEventListener\("online", handleOnline\)/);
assert.match(liveSource, /refreshDelta/);
assert.match(liveSource, /cockpitSavedViewsKey/);
assert.match(liveSource, /buildSignalOpsCockpitBriefV1/);
assert.match(liveSource, /buildSignalOpsCockpitJsonExportV1/);
assert.match(liveSource, /DimensionSelect label="Operation kind"/);
assert.match(liveSource, /DimensionSelect label="Service"/);
assert.match(liveSource, /DimensionSelect label="Environment"/);
assert.match(liveSource, /DimensionSelect label="Release"/);
assert.match(liveSource, /Retryable failures/);
assert.match(liveSource, /Unclassified failures/);
assert.match(liveSource, /Missing attempt evidence/);
assert.match(liveSource, /Multiple attempts/);
assert.match(liveSource, /SelectionCheckbox/);
assert.match(liveSource, /OperationComparison/);
assert.match(liveSource, /filterAndSortSignalOpsModelsV1/);
assert.match(liveSource, /filterAndSortSignalOpsProvidersV1/);
assert.match(liveSource, /max-h-\[68vh\][^\"]*overflow-auto/);
assert.match(liveSource, /sticky top-0/);
assert.match(liveSource, /absoluteUtcTime/);
assert.match(liveSource, /function AnalysisGroup/);
assert.match(liveSource, /Back to top/);
assert.match(commandPaletteSource, /Command cockpit/);
assert.match(commandPaletteSource, /Search cockpit commands and saved views/);
assert.match(commandPaletteSource, /Free-form search and operation IDs are never persisted/);
assert.match(commandPaletteSource, /<Dialog\.Root/);
assert.match(windowPulseSource, /Recent half versus the earlier equal-duration half/);
assert.match(windowPulseSource, /View canonical timeline as a table/);
assert.match(windowPulseSource, /not recombined into a synthetic percentile/);
assert.match(cockpitViewSource, /export function filterSignalOpsOperationsV1/);
assert.match(cockpitViewSource, /export function paginateSignalOpsRowsV1/);

const {
  applySignalOpsCockpitViewV1,
  buildSignalOpsCockpitBriefV1,
  buildSignalOpsCockpitJsonExportV1,
  buildSignalOpsOperationsCsvV1,
  createSignalOpsSavedCockpitViewV1,
  createSignalOpsCockpitShareUrlV1,
  filterAndSortSignalOpsModelsV1,
  filterAndSortSignalOpsOperationsV1,
  filterAndSortSignalOpsProvidersV1,
  filterSignalOpsOperationsV1,
  listSignalOpsOperationDimensionValuesV1,
  mergeSignalOpsOperationSamplesV1,
  paginateSignalOpsRowsV1,
  readSignalOpsSavedCockpitViewsV1,
  serializeSignalOpsSavedCockpitViewsV1,
  summarizeSignalOpsTimelineV1,
  applySignalOpsCockpitRangeV1,
  readSignalOpsCockpitViewV1,
  readSignalOpsCockpitRangeV1,
} = await import("../src/lib/signalops/v1/cockpit-view.ts");
const operationRows = [
  { operationId: "ok", status: "succeeded" },
  { operationId: "bad", status: "failed" },
  { operationId: "running", status: "running" },
];
assert.deepEqual(
  filterSignalOpsOperationsV1(operationRows, "failed").map((row) => row.operationId),
  ["bad"],
);
assert.deepEqual(
  filterSignalOpsOperationsV1(operationRows, "all").map((row) => row.operationId),
  ["ok", "bad", "running"],
);
assert.deepEqual(
  paginateSignalOpsRowsV1(["a", "b", "c", "d", "e"], 2, 2),
  { rows: ["c", "d"], page: 2, pageCount: 3, total: 5 },
);
assert.deepEqual(
  paginateSignalOpsRowsV1(["a", "b", "c"], 99, 2),
  { rows: ["c"], page: 2, pageCount: 2, total: 3 },
);
assert.equal(readSignalOpsCockpitRangeV1("?range=7d"), "7d");
assert.equal(
  readSignalOpsCockpitRangeV1("?range=tomorrow"),
  "90d",
  "Invalid shared range links must fall back to the live cockpit default.",
);
assert.equal(
  applySignalOpsCockpitRangeV1(
    new URL("https://signalops.cc/cockpit?auth=callback-failed#routes"),
    "24h",
  ).toString(),
  "https://signalops.cc/cockpit?auth=callback-failed&range=24h#routes",
  "Range links must remain shareable without discarding other cockpit context.",
);

const retainedRows = mergeSignalOpsOperationSamplesV1(
  [
    {
      operationId: "op-new",
      status: "succeeded",
      logicalModelKey: "fast-image",
      kind: "image_generation",
      durationMs: 150,
      attemptCount: 1,
      environment: "production",
      service: "api",
      occurredAt: "2026-08-24T10:00:00.000Z",
    },
    {
      operationId: "op-failed",
      status: "failed",
      logicalModelKey: "quality-video",
      kind: "video_generation",
      durationMs: 9_500,
      attemptCount: 3,
      environment: "production",
      service: "worker",
      occurredAt: "2026-08-24T09:00:00.000Z",
      failureCategory: "provider_timeout",
      failureCode: "PROVIDER_DEADLINE",
      failureRetryable: true,
    },
  ],
  [
    {
      operationId: "op-failed",
      status: "failed",
      logicalModelKey: "quality-video",
      kind: "video_generation",
      durationMs: 9_500,
      attemptCount: 3,
      environment: "production",
      service: "worker",
      occurredAt: "2026-08-24T09:00:00.000Z",
      failureCategory: "provider_timeout",
      failureCode: "PROVIDER_DEADLINE",
      failureRetryable: true,
    },
    {
      operationId: "op-old-failed",
      status: "abandoned",
      kind: "text_generation",
      durationMs: null,
      attemptCount: 2,
      environment: "staging",
      service: "queue",
      occurredAt: "2026-08-20T09:00:00.000Z",
      failureCategory: "application_error",
    },
  ],
);
assert.deepEqual(
  retainedRows.map((row) => row.operationId),
  ["op-new", "op-failed", "op-old-failed"],
  "Recent and retained-failure samples must be de-duplicated without losing older failures.",
);
assert.deepEqual(
  filterAndSortSignalOpsOperationsV1(retainedRows, {
    status: "failed",
    query: "deadline",
    model: "quality-video",
    failure: "provider_timeout",
    sort: "slowest",
  }).map((row) => row.operationId),
  ["op-failed"],
  "Search and dimensions must use canonical retained operation fields.",
);
assert.deepEqual(
  filterAndSortSignalOpsOperationsV1(retainedRows, {
    status: "all",
    query: "",
    model: null,
    failure: null,
    sort: "attention",
  }).map((row) => row.operationId),
  ["op-failed", "op-old-failed", "op-new"],
  "Attention sorting must surface unsuccessful outcomes before successes.",
);
assert.deepEqual(
  filterAndSortSignalOpsOperationsV1(retainedRows, {
    status: "all",
    query: "",
    model: null,
    failure: null,
    sort: "slowest",
  }).map((row) => row.operationId),
  ["op-failed", "op-new", "op-old-failed"],
  "Missing durations must remain below measured durations when sorting by latency.",
);

assert.deepEqual(
  readSignalOpsCockpitViewV1(
    "?range=7d&status=failed&model=quality-video&failure=provider_timeout&sort=slowest&operation=op-failed",
  ),
  {
    range: "7d",
    status: "failed",
    model: "quality-video",
    failure: "provider_timeout",
    kind: null,
    service: null,
    environment: null,
    release: null,
    triage: "all",
    sort: "slowest",
    operationId: "op-failed",
  },
  "Safe investigation state must round-trip from a shared URL.",
);
assert.deepEqual(
  readSignalOpsCockpitViewV1("?status=hacked&sort=random&operation=%0A", "30d"),
  {
    range: "30d",
    status: "all",
    model: null,
    failure: null,
    kind: null,
    service: null,
    environment: null,
    release: null,
    triage: "all",
    sort: "newest",
    operationId: null,
  },
  "Invalid shared view parameters must fail closed to documented defaults.",
);
const sharedView = {
  range: "24h",
  status: "failed",
  model: null,
  failure: "provider_timeout",
  kind: null,
  service: null,
  environment: "production",
  release: null,
  triage: "retryable",
  sort: "attention",
  operationId: "op-failed",
};
assert.equal(
  applySignalOpsCockpitViewV1(
    new URL("https://signalops.cc/cockpit?auth=callback-failed&campaign=secret"),
    sharedView,
  ).toString(),
  "https://signalops.cc/cockpit?auth=callback-failed&campaign=secret&range=24h&status=failed&failure=provider_timeout&environment=production&triage=retryable&sort=attention&operation=op-failed",
  "In-app history updates must retain unrelated callback context.",
);
assert.equal(
  createSignalOpsCockpitShareUrlV1(
    new URL("https://signalops.cc/cockpit?auth=callback-failed&campaign=secret"),
    sharedView,
  ).toString(),
  "https://signalops.cc/cockpit?range=24h&status=failed&failure=provider_timeout&environment=production&triage=retryable&sort=attention&operation=op-failed",
  "Copied view links must contain only the explicit privacy-safe cockpit state.",
);

assert.deepEqual(
  listSignalOpsOperationDimensionValuesV1(retainedRows, "kind"),
  ["image_generation", "text_generation", "video_generation"],
  "Canonical explorer dimensions must be unique and stable.",
);
assert.deepEqual(
  filterAndSortSignalOpsOperationsV1(retainedRows, {
    status: "all",
    query: "",
    model: null,
    failure: null,
    kind: "video_generation",
    service: "worker",
    environment: "production",
    release: null,
    triage: "retryable",
    slowThresholdMs: 9_000,
    sort: "newest",
  }).map((row) => row.operationId),
  ["op-failed"],
  "Dimension and triage filters must compose over retained canonical rows.",
);
assert.deepEqual(
  filterAndSortSignalOpsOperationsV1(retainedRows, {
    status: "all",
    query: "",
    model: null,
    failure: null,
    kind: null,
    service: null,
    environment: null,
    release: null,
    triage: "slow",
    slowThresholdMs: 9_000,
    sort: "newest",
  }).map((row) => row.operationId),
  ["op-failed"],
  "Slow triage must use the explicit current-window threshold and exclude missing durations.",
);

assert.deepEqual(
  filterAndSortSignalOpsModelsV1(
    [
      { modelKey: "small", operations: 10, succeeded: 10, failed: 0, successRate: 1, p95DurationMs: 100 },
      { modelKey: "large", operations: 8, succeeded: 3, failed: 5, successRate: 0.375, p95DurationMs: 900 },
    ],
    "",
    "failures",
  ).map((row) => row.modelKey),
  ["large", "small"],
  "Model tooling must surface the most failure-heavy logical model first.",
);
assert.deepEqual(
  filterAndSortSignalOpsProvidersV1(
    [
      { providerKey: "direct", modelKey: "small", attempts: 20, succeeded: 20, failed: 0, successRate: 1, retryableFailures: 0, p95DurationMs: 100, costByCurrency: [], health: { status: "healthy", sampleSize: 20, failureRate: 0, p95DurationMs: 100, windowMinutes: 10, policyVersion: "v1" } },
      { providerKey: "gateway", modelKey: "large", attempts: 5, succeeded: 2, failed: 3, successRate: 0.4, retryableFailures: 2, p95DurationMs: 900, costByCurrency: [], health: { status: "incident", sampleSize: 5, failureRate: 0.6, p95DurationMs: 900, windowMinutes: 10, policyVersion: "v1" } },
    ],
    "gate",
    "attention",
  ).map((row) => row.providerKey),
  ["gateway"],
  "Provider tooling must search exact route evidence and sort by policy health.",
);

const timelineFixture = [
  { start: "2026-08-24T00:00:00.000Z", end: "2026-08-24T01:00:00.000Z", operations: 10, failedOperations: 1, attempts: 11, failedAttempts: 1, p95DurationMs: 100, costByCurrency: [] },
  { start: "2026-08-24T01:00:00.000Z", end: "2026-08-24T02:00:00.000Z", operations: 20, failedOperations: 4, attempts: 22, failedAttempts: 4, p95DurationMs: 500, costByCurrency: [] },
  { start: "2026-08-24T02:00:00.000Z", end: "2026-08-24T03:00:00.000Z", operations: 15, failedOperations: 0, attempts: 16, failedAttempts: 0, p95DurationMs: 300, costByCurrency: [] },
  { start: "2026-08-24T03:00:00.000Z", end: "2026-08-24T04:00:00.000Z", operations: 45, failedOperations: 9, attempts: 48, failedAttempts: 9, p95DurationMs: 1_200, costByCurrency: [] },
];
const pulse = summarizeSignalOpsTimelineV1(timelineFixture);
assert.deepEqual(pulse.earlier, {
  operations: 30,
  failedOperations: 5,
  attempts: 33,
  failureRate: 1 / 6,
});
assert.deepEqual(pulse.recent, {
  operations: 60,
  failedOperations: 9,
  attempts: 64,
  failureRate: 0.15,
});
assert.equal(pulse.operationDeltaRatio, 1);
assert.equal(pulse.peaks.volume?.start, "2026-08-24T03:00:00.000Z");
assert.equal(pulse.peaks.failureRate?.start, "2026-08-24T03:00:00.000Z");
assert.equal(pulse.peaks.latency?.start, "2026-08-24T03:00:00.000Z");

const savedView = createSignalOpsSavedCockpitViewV1(
  "view-1",
  "Retryable production failures",
  sharedView,
  "2026-08-24T12:00:00.000Z",
);
assert.ok(savedView);
assert.equal(savedView.view.operationId, null, "Saved views must not pin a trace identifier.");
assert.deepEqual(
  readSignalOpsSavedCockpitViewsV1(
    serializeSignalOpsSavedCockpitViewsV1([savedView]),
  ),
  [savedView],
  "Saved views must round-trip through bounded local persistence.",
);
assert.deepEqual(
  readSignalOpsSavedCockpitViewsV1('[{"id":"bad id","name":"x","createdAt":"never","view":{}}]'),
  [],
  "Malformed persisted views must fail closed.",
);

const snapshotFixture = {
  tenant: { id: "tenant-1", name: "Example workspace" },
  range: "24h",
  generatedAt: "2026-08-24T12:00:00.000Z",
  freshness: { lastEventAt: "2026-08-24T11:59:00.000Z", lastReceivedAt: "2026-08-24T11:59:01.000Z" },
  projection: { materialized: true, checkpointReceivedAt: "2026-08-24T11:59:02.000Z", sourceEventCount: 12 },
  dataQuality: { complete: true, truncated: false, contradictoryTerminals: 0, identityCollisions: 0, idempotencyConflicts: 0 },
  totals: { events: 12, operations: 3, attempts: 4, succeeded: 2, failed: 1, successRate: 2 / 3, p95DurationMs: 9_500, retryableFailures: 1, operationsWithDuration: 3, operationsWithAttemptTelemetry: 2, costByCurrency: [] },
  coverage: {
    operationAcceptance: { observed: 3, total: 3, ratio: 1 },
    operationCompletion: { observed: 3, total: 3, ratio: 1 },
    providerAttempts: { observed: 2, total: 3, ratio: 2 / 3 },
    attemptLifecycle: { observed: 4, total: 4, ratio: 1 },
    failureClassification: { observed: 1, total: 1, ratio: 1 },
    failureCodes: { observed: 1, total: 1, ratio: 1 },
    costEvidence: { observed: 0, total: 4, ratio: 0 },
  },
  environments: ["production"],
  timeline: timelineFixture,
  providers: [],
  models: [],
  failureBreakdown: [],
  recentOperations: retainedRows,
  recentFailedOperations: retainedRows.filter((row) => row.status !== "succeeded"),
};
const brief = buildSignalOpsCockpitBriefV1(snapshotFixture, sharedView, 1, 3);
assert.match(brief, /SignalOps investigation brief/);
assert.match(brief, /Retained view: 1 matches across 3 indexed rows/);
assert.doesNotMatch(brief, /free-form-secret/);
const jsonExport = buildSignalOpsCockpitJsonExportV1(
  snapshotFixture,
  sharedView,
  [retainedRows[1]],
  "2026-08-24T12:01:00.000Z",
);
assert.match(jsonExport, /com\.signalops\.cockpit\.export\.v1/);
assert.match(jsonExport, /"retainedOperations"/);
assert.doesNotMatch(jsonExport, /"session"|free-form-secret|recentOperations/);

const csv = buildSignalOpsOperationsCsvV1([
  {
    ...retainedRows[0],
    operationId: "  =unsafe",
    release: "release,one",
  },
]);
assert.match(csv, /^"Operation ID","Status","Logical model"/);
assert.match(csv, /"'  =unsafe"/);
assert.match(csv, /"release,one"/);
assert.ok(csv.endsWith("\r\n"), "CSV downloads must use spreadsheet-compatible CRLF rows.");

console.log("signalops live cockpit v1 checks passed");
