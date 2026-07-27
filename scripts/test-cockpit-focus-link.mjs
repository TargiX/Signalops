import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const dashboardSource = await readFile(
  path.join(repoRoot, "src", "components", "dashboard.tsx"),
  "utf8",
);
const incidentDetailSource = await readFile(
  path.join(repoRoot, "src", "components", "incident-detail.tsx"),
  "utf8",
);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Expected ${name} to be defined.`);

  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  assert.fail(`Expected ${name} to have a complete function body.`);
}

const buildFocusedCockpitUrl = new Function(
  `${extractFunction(incidentDetailSource, "buildFocusedCockpitUrl").replace("(incidentId: string)", "(incidentId)")}\nreturn buildFocusedCockpitUrl;`,
)();
const readCockpitFocusParams = new Function(
  `${extractFunction(dashboardSource, "readCockpitFocusParams")}\nreturn readCockpitFocusParams;`,
)();

assert.equal(
  buildFocusedCockpitUrl("inc_411"),
  "/cockpit?incident=inc_411&view=triage",
  "Expected an incident handoff to target the bounded triage context.",
);
assert.equal(
  buildFocusedCockpitUrl("inc / special"),
  "/cockpit?incident=inc%20%2F%20special&view=triage",
  "Expected incident ids to be encoded before entering the URL.",
);

const previousWindow = globalThis.window;
globalThis.window = { location: { search: "?incident=inc_411&view=triage" } };
assert.equal(readCockpitFocusParams(), "inc_411");
globalThis.window.location.search = "?incident=inc_411";
assert.equal(readCockpitFocusParams(), null, "Focus should require the explicit triage view.");
globalThis.window.location.search = "?incident=&view=triage";
assert.equal(readCockpitFocusParams(), null, "Focus should reject an empty incident id.");
globalThis.window = previousWindow;

assert.match(
  dashboardSource,
  /const incident = data\.incidents\.find\([\s\S]*?item\.id === cockpitFocusIncidentId[\s\S]*?\);/,
  "Expected the cockpit to resolve focus only against the loaded incident set.",
);
assert.match(
  dashboardSource,
  /setSavedView\("triage"\);[\s\S]*?setQueueFocusProviderId\(incident\.providerId\);[\s\S]*?setQueueFocusStatus\("all"\);/,
  "Expected a valid handoff to select triage and focus the incident provider queue.",
);
assert.match(
  dashboardSource,
  /replayScenarioId \|\|[\s\S]*?!cockpitFocusIncidentId/,
  "Expected replay links to take precedence over a cockpit focus handoff.",
);
assert.doesNotMatch(
  dashboardSource,
  /cockpitFocusIncidentId[\s\S]{0,160}applyRuleMutation\.mutate/,
  "A focus handoff must not apply a routing rule.",
);
assert.match(
  incidentDetailSource,
  /href=\{buildFocusedCockpitUrl\(incident\.id\)\}[\s\S]*?Continue focused triage/,
  "Expected a visible focused-triage action on incident detail.",
);

console.log("Cockpit focus handoff contract OK: a bounded incident link restores triage without applying routing.");
