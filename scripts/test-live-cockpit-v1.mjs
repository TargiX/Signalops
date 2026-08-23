import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  pageSource,
  liveSource,
  dashboardSource,
  chartSource,
  snapshotSource,
  projectionSource,
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
assert.match(snapshotSource, /timeline: SignalOpsTimelineBucketV1\[\]/);
assert.match(snapshotSource, /models: SignalOpsModelSnapshotV1\[\]/);
assert.match(projectionSource, /Array\.isArray\(row\.snapshot\?\.timeline\)/);
assert.match(projectionSource, /Array\.isArray\(row\.snapshot\?\.models\)/);
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
  3,
  "Every live timeline label formatter must render the documented UTC buckets in UTC.",
);
assert.doesNotMatch(
  liveSource,
  /Phosphene|customer email|Apply routing rule/i,
  "The reusable live cockpit must not hard-code its first tenant or demo-only controls.",
);

console.log("signalops live cockpit v1 checks passed");
