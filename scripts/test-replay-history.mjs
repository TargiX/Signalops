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
const incidentReplayPath = path.join(repoRoot, "src/components/incident-replay.tsx");
const incidentReplaySource = await readFile(incidentReplayPath, "utf8");
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

function finishReplay() {
  const nextUrl = applyReplayUrlState(entries[cursor], {
    scenarioId: null,
    step: 0,
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

finishReplay();
const writesAfterFinish = writes;
assert.deepEqual(restore(), {
  scenarioId: null,
  step: 0,
  incidentId: "inc_411",
  routingApplied: false,
  exportNextAction: false,
});
cursor -= 1;
assert.deepEqual(
  restore(),
  {
    scenarioId: "alibaba-p95",
    step: 4,
    incidentId: "inc_411",
    routingApplied: true,
    exportNextAction: true,
  },
  "Back after Finish replay must restore the terminal Export context, not replay step 1.",
);
cursor += 1;
assert.deepEqual(
  restore(),
  {
    scenarioId: null,
    step: 0,
    incidentId: "inc_411",
    routingApplied: false,
    exportNextAction: false,
  },
  "Forward after Finish replay must restore the completed replay launcher.",
);

const replayRoutingAppliedKeys = new Set();
const rangeSnapshots = new Map();
let routingWrites = 0;

function replayRoutingKey({ range, scenarioId, step }) {
  return `${range}:${scenarioId}:${step}`;
}

function reconcileReplayRouting({ range, scenarioId, step, routingApplied }) {
  const snapshot = rangeSnapshots.get(range);
  const key = replayRoutingKey({ range, scenarioId, step });

  if (!snapshot || replayRoutingAppliedKeys.has(key)) {
    return false;
  }

  rangeSnapshots.set(range, {
    ...snapshot,
    activeRoutingRule: routingApplied
      ? { id: `rule_${scenarioId}_${step}`, scenarioId, step }
      : null,
  });
  replayRoutingAppliedKeys.add(key);
  routingWrites += 1;
  return true;
}

const coldRangeReplay = {
  range: "7d",
  scenarioId: "alibaba-p95",
  step: 3,
  routingApplied: true,
};
assert.equal(
  reconcileReplayRouting(coldRangeReplay),
  false,
  "A cold range must wait for its exact snapshot instead of recording a stale applied key.",
);
rangeSnapshots.set("7d", { activeRoutingRule: null });
assert.equal(
  reconcileReplayRouting(coldRangeReplay),
  true,
  "Arrival of the cold range snapshot must apply the current replay routing rule.",
);
assert.deepEqual(rangeSnapshots.get("7d")?.activeRoutingRule, {
  id: "rule_alibaba-p95_3",
  scenarioId: "alibaba-p95",
  step: 3,
});
const routingWritesAfterArrival = routingWrites;
assert.equal(
  reconcileReplayRouting(coldRangeReplay),
  false,
  "Repeated snapshot resolution must not duplicate the replay routing rule.",
);
assert.equal(
  routingWrites,
  routingWritesAfterArrival,
  "Repeated snapshot resolution must leave the active routing rule as one write.",
);

assert.equal(
  reconcileReplayRouting({ ...coldRangeReplay, step: 1, routingApplied: false }),
  true,
  "A non-routing replay step must reconcile the same range after routing was active.",
);
assert.equal(
  rangeSnapshots.get("7d")?.activeRoutingRule,
  null,
  "A non-routing replay step must clear the prior active routing rule.",
);
assert.equal(routingWrites, 2, "Only the routing and clearing replay states should write once each.");
assert.equal(writes, writesAfterFinish, "Routing reconciliation must not create history entries.");

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
assert.equal(
  (incidentReplaySource.match(/onClick=\{\(\) => onExit\(\)\}/g) ?? []).length,
  2,
  "Exit replay and Finish replay must invoke onExit without forwarding the click event as a history mode.",
);
assert.match(
  dashboardSource,
  /setSelectedIncidentId\(step\.state\.selectedIncidentId\)[\s\S]*?setReplayRoutingRule\(scenario, step\)/,
  "Expected restored replay steps to reconcile the selected incident and routing context.",
);
assert.match(
  dashboardSource,
  /const replayRoutingAppliedKey = useRef<string \| null>\(null\)/,
  "Expected replay routing reconciliation to track the current range/scenario/step instead of one deep-link lifetime.",
);
assert.match(
  dashboardSource,
  /replayRoutingAppliedKey\.current = setReplayRoutingRule\(scenario, step\)[\s\S]*?\? routingKey\s*:\s*null/,
  "Expected a cold-cache replay transition to remain eligible for post-fetch reconciliation.",
);
assert.match(
  dashboardSource,
  /routingKey !== replayRoutingAppliedKey\.current[\s\S]*?setReplayRoutingRule\(scenario, step\)[\s\S]*?replayRoutingAppliedKey\.current = routingKey/,
  "Expected each resolved range/scenario/step to apply routing exactly once.",
);
assert.match(
  dashboardSource,
  /\}, \[data, range, replayScenarioId, replayStepIndex\]\);/,
  "Expected routing reconciliation to retry when the range or replay state changes.",
);

console.log(
  "Replay history contracts OK: step entries, Finish -> Back -> Forward terminal continuity, cold-cache routing reconciliation, and no recursive write.",
);
