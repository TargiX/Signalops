import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanonicalIncidentUrl,
  buildIncidentHandoff,
} from "../src/lib/incident-handoff.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const homeSourcePath = path.join(repoRoot, "src/components/product-home.tsx");
const validatePagePath = path.join(repoRoot, "src/app/validate/page.tsx");
const incidentDetailSourcePath = path.join(
  repoRoot,
  "src/components/incident-detail.tsx",
);
const layoutSourcePath = path.join(repoRoot, "src/app/layout.tsx");
const dashboardSourcePath = path.join(repoRoot, "src/components/dashboard.tsx");

const homeSource = await readFile(homeSourcePath, "utf8");

const validateHrefPattern =
  /<Link\b[^>]*\bhref=\{?\s*["']\/validate["']\s*\}?[^>]*>/;

assert.match(
  homeSource,
  validateHrefPattern,
  "Expected homepage to contain a static /validate Link href.",
);

await access(validatePagePath);

const canonicalIncidentUrl = buildCanonicalIncidentUrl("inc_411");
assert.equal(
  canonicalIncidentUrl,
  "https://signalops.ilyamoskovkin.com/incidents/inc_411#handoff",
);

const layoutSource = await readFile(layoutSourcePath, "utf8");
const escapedIncidentOrigin = new URL(canonicalIncidentUrl).origin.replace(
  /[.*+?^${}()|[\]\\]/g,
  "\\$&",
);
assert.match(
  layoutSource,
  new RegExp(
    `metadataBase: new URL\\(["']${escapedIncidentOrigin}["']\\)`,
  ),
  "Expected the incident handoff origin to match the app metadata base.",
);

const dashboardSource = await readFile(dashboardSourcePath, "utf8");
const replayUrlWriterStart = dashboardSource.indexOf("function writeReplayUrlState(");
const replayUrlWriterEnd = dashboardSource.indexOf(
  "/** Normalize direct links",
  replayUrlWriterStart,
);
const replayUrlWriter = dashboardSource.slice(replayUrlWriterStart, replayUrlWriterEnd);

assert.ok(
  replayUrlWriterStart >= 0 && replayUrlWriterEnd > replayUrlWriterStart,
  "Expected dashboard to define the replay URL writer.",
);
assert.match(
  replayUrlWriter,
  /try\s*\{[\s\S]*?history\.pushState[\s\S]*?history\.replaceState[\s\S]*?\}\s*catch\s*\{[\s\S]*?return false;/,
  "Expected thrown History API mutations to be contained by the replay URL writer.",
);
assert.match(
  dashboardSource,
  /setReplayScenarioId\(scenarioId\);[\s\S]*?setReplayStepIndex\(boundedIndex\);[\s\S]*?settleReplayUrl\(scenarioId, boundedIndex, historyMode\);/,
  "Expected replay state to advance before URL synchronization settles.",
);
assert.match(
  dashboardSource,
  /const \[replayUrlError, setReplayUrlError\] = useState<string \| null>\(null\);/,
  "Expected bounded replay URL synchronization failure state.",
);
assert.match(
  dashboardSource,
  /Replay advanced, but the address bar could not be updated\./,
  "Expected URL synchronization failure copy to remain truthful.",
);
assert.match(
  dashboardSource,
  /setReplayUrlError\(\s*synchronized\s*\?\s*null\s*:/,
  "Expected a successful URL synchronization to clear the failure state.",
);
const replayUrlErrorRenderStart = dashboardSource.indexOf("{replayUrlError ? (");
const replayUrlErrorRenderEnd = dashboardSource.indexOf(
  "\n\n        <IncidentReplay",
  replayUrlErrorRenderStart,
);
const replayUrlErrorRender = dashboardSource.slice(
  replayUrlErrorRenderStart,
  replayUrlErrorRenderEnd,
);

assert.ok(
  replayUrlErrorRenderStart >= 0 && replayUrlErrorRenderEnd > replayUrlErrorRenderStart,
  "Expected dashboard to render replay URL synchronization recovery next to the replay controls.",
);
assert.match(
  replayUrlErrorRender,
  /role="alert"[\s\S]*?Retry URL sync/,
  "Expected an accessible replay URL synchronization failure with a visible retry.",
);
assert.match(
  replayUrlErrorRender,
  /settleReplayUrl\(replayScenarioId, replayStepIndex, "replace"\)/,
  "Expected retry to synchronize the current replay id and step without a new history entry.",
);

const handoff = buildIncidentHandoff({
  incident: {
    id: "inc_411",
    title: "Qwen Image timeout cluster",
    severity: "critical",
  },
  provider: {
    name: "Alibaba",
    region: "ap-southeast",
  },
  affectedJobCount: 72,
  guard: "latency",
  trafficShare: 68,
  decisionState: "simulated",
  projected: {
    movedJobs: 196,
    p95Ms: 14_452,
    failureRate: 5.9,
  },
  canonicalUrl: canonicalIncidentUrl,
});

assert.equal(
  handoff,
  [
    "# Incident handoff — inc_411",
    "",
    "**Qwen Image timeout cluster** · CRITICAL",
    "Scope: 72 affected jobs on Alibaba (ap-southeast)",
    "Decision: SIMULATED — drain 68% of Alibaba traffic when p95 > 12s",
    "Projected: 196 jobs moved · p95 14.5s · failure rate 5.9%",
    "State: PREVIEW ONLY — no routing change has been applied",
    `Canonical incident: ${canonicalIncidentUrl}`,
  ].join("\n"),
);

const appliedHandoff = buildIncidentHandoff({
  incident: {
    id: "inc_411",
    title: "Qwen Image timeout cluster",
    severity: "critical",
  },
  provider: {
    name: "Alibaba",
    region: "ap-southeast",
  },
  affectedJobCount: 72,
  guard: "failure",
  trafficShare: 90,
  decisionState: "applied",
  appliedAt: "2026-07-19T12:00:00.000Z",
  projected: {
    movedJobs: 259,
    p95Ms: 13_048,
    failureRate: 4.8,
  },
  canonicalUrl: canonicalIncidentUrl,
});

assert.match(
  appliedHandoff,
  /Decision: APPLIED — drain 90% of Alibaba traffic when failure > 5%/,
);
assert.match(
  appliedHandoff,
  /State: ACTIVE — applied at 2026-07-19T12:00:00.000Z in the current 24h snapshot/,
);

const incidentDetailSource = await readFile(incidentDetailSourcePath, "utf8");
assert.match(
  incidentDetailSource,
  /<section\b[^>]*\bid=["']handoff["'][^>]*>/,
  "Expected incident detail to expose a linkable handoff section.",
);
assert.match(
  incidentDetailSource,
  />\s*Copy handoff\s*</,
  "Expected incident detail to expose a keyboard-operable handoff copy control.",
);
assert.match(
  incidentDetailSource,
  /const simulated = simulatedRuleKey === draftRuleKey/,
  "Expected simulation state to be tied to the exact editable rule inputs.",
);
assert.match(
  incidentDetailSource,
  /copyState\.content === content/,
  "Expected clipboard feedback to be tied to the exact handoff content version.",
);
assert.match(
  incidentDetailSource,
  /const attempt = \+\+copyAttempt\.current/,
  "Expected newer clipboard attempts to invalidate older async completions.",
);
assert.match(
  incidentDetailSource,
  /aria-pressed=\{active\}/,
  "Expected guard controls to expose the selected option programmatically.",
);
assert.match(
  incidentDetailSource,
  /queryKey:\s*\["ops-snapshot",\s*"24h"\]/,
  "Expected incident handoffs to share the dashboard's 24h routing snapshot cache.",
);

console.log(
  "Navigation and incident handoff contracts OK: routes, decision state, scope, and canonical URL.",
);
