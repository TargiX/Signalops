import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyReplayUrlState,
  parseReplayUrlState,
} from "../src/lib/replay-url.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const dashboardPath = path.join(repoRoot, "src/components/dashboard.tsx");
const dashboardSource = await readFile(dashboardPath, "utf8");
const stepCounts = new Map([["alibaba-p95", 5]]);
const controlContext = [
  { incidentId: "inc_411", routingApplied: false, exportNextAction: false },
  { incidentId: "inc_411", routingApplied: false, exportNextAction: false },
  { incidentId: "inc_411", routingApplied: false, exportNextAction: false },
  { incidentId: "inc_411", routingApplied: true, exportNextAction: false },
  { incidentId: "inc_411", routingApplied: true, exportNextAction: true },
];

const entries = [new URL("https://signalops.example/")];
let cursor = 0;
let writes = 0;

function visit(step) {
  const nextUrl = applyReplayUrlState(entries[cursor], {
    scenarioId: "alibaba-p95",
    step,
  });

  if (nextUrl.href === entries[cursor].href) {
    return;
  }

  entries.splice(cursor + 1);
  entries.push(nextUrl);
  cursor += 1;
  writes += 1;
}

function restore() {
  const state = parseReplayUrlState(entries[cursor].search, stepCounts);
  return { ...state, ...controlContext[state.step] };
}

visit(0);
visit(1);
visit(2);
assert.equal(entries.length, 4, "Each user-driven replay step should push one history entry.");
assert.deepEqual(restore(), {
  scenarioId: "alibaba-p95",
  step: 2,
  incidentId: "inc_411",
  routingApplied: false,
  exportNextAction: false,
});

cursor -= 1;
assert.deepEqual(restore(), {
  scenarioId: "alibaba-p95",
  step: 1,
  incidentId: "inc_411",
  routingApplied: false,
  exportNextAction: false,
});
cursor -= 1;
assert.equal(restore().step, 0, "Back should restore the first replay step.");
cursor += 1;
assert.equal(restore().step, 1, "Forward should restore the second replay step.");
cursor += 1;
assert.equal(restore().step, 2, "Forward should restore the latest replay step.");

visit(4);
assert.deepEqual(restore(), {
  scenarioId: "alibaba-p95",
  step: 4,
  incidentId: "inc_411",
  routingApplied: true,
  exportNextAction: true,
});
const writesBeforeRestore = writes;
restore();
assert.equal(writes, writesBeforeRestore, "Restoring history must not write another entry.");

assert.match(
  dashboardSource,
  /function writeReplayUrlState\([\s\S]*?history\.pushState/,
  "Expected user-driven replay transitions to push browser history entries.",
);
assert.match(
  dashboardSource,
  /window\.addEventListener\("popstate", handlePopState\)/,
  "Expected a popstate listener to reconcile browser navigation.",
);
assert.match(
  dashboardSource,
  /goToReplayStep\(state\.scenarioId, state\.step, "none"\)/,
  "Expected popstate replay restoration to avoid recursive history writes.",
);
assert.match(
  dashboardSource,
  /exitReplay\("none"\)/,
  "Expected popstate exit restoration to avoid recursive history writes.",
);
assert.match(
  dashboardSource,
  /setSelectedIncidentId\(step\.state\.selectedIncidentId\)[\s\S]*?setReplayRoutingRule\(scenario, step\)/,
  "Expected restored replay steps to reconcile the selected incident and routing context.",
);

console.log(
  "Replay history contracts OK: step entries, Back/Forward restoration, completion/export context, and no recursive write.",
);
