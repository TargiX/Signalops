import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const consumerDetailPath = path.join(scriptDir, "..", "src", "components", "consumer-detail.tsx");
const consumerDetailSource = await readFile(consumerDetailPath, "utf8");

assert.match(
  consumerDetailSource,
  /function formatSessionGuardHandoff\(/,
  "Expected an explicit formatter for the shareable session-guard record.",
);
assert.match(
  consumerDetailSource,
  /Decision: ACTIVE — hold requests after account spend reaches/,
  "Expected the handoff to report only an active guard decision.",
);
assert.match(
  consumerDetailSource,
  /State: SESSION ONLY — no billing, credits, or server-side policy changed/,
  "Expected the handoff to keep the session-only boundary explicit.",
);
assert.match(
  consumerDetailSource,
  /function normalizeCeiling\(value: number\) \{\s*return Number\.isFinite\(value\) \? Math\.max\(0, value\) : 0;\s*\}/,
  "Expected one bounded ceiling normalization for manual numeric input.",
);
assert.match(
  consumerDetailSource,
  /const ceiling = normalizeCeiling\(ceilingOverride \?\? \(consumer \? Math\.max\(1, Math\.floor\(consumer\.spend \* 0\.8\)\) : 0\)\);/,
  "Expected preview, simulation, activation, and handoff to share the bounded ceiling.",
);
assert.match(
  consumerDetailSource,
  /const nextCeiling = Number\(event\.target\.value\);[\s\S]*?setCeilingOverride\(normalizeCeiling\(nextCeiling\)\);/,
  "Expected a manually typed negative ceiling to be bounded before it can be simulated or activated.",
);
assert.match(
  consumerDetailSource,
  /const activeHandoff =[\s\S]*?activeCeiling === null[\s\S]*?formatSessionGuardHandoff/,
  "Expected no handoff to exist before a session guard is active.",
);
assert.match(
  consumerDetailSource,
  /await navigator\.clipboard\.writeText\(activeHandoff\)/,
  "Expected the copy action to copy the exact active handoff content.",
);
assert.match(
  consumerDetailSource,
  /copyState\?\.content === activeHandoff && copyState\.status === "copied"/,
  "Expected copy feedback to be tied to the exact active handoff version.",
);
assert.match(
  consumerDetailSource,
  /<section[\s\S]*?id="handoff"[\s\S]*?Session guard handoff[\s\S]*?Copy session guard handoff/,
  "Expected activated guards to render a linkable, keyboard-operable handoff surface.",
);
assert.match(
  consumerDetailSource,
  /copyState\?\.content === activeHandoff && copyState\.status === "error"[\s\S]*?role="alert"/,
  "Expected clipboard failures to remain visible and actionable.",
);

console.log("Consumer guard handoff contract OK: active-only, truthful, versioned, and recoverable.");
