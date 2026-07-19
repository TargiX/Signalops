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
