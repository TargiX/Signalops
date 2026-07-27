import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const consumerDetailPath = path.join(scriptDir, "..", "src", "components", "consumer-detail.tsx");
const consumerDetailSource = await readFile(consumerDetailPath, "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected ${name} to be defined.`);

  const bodyStart = source.indexOf(") {", start) + 2;
  assert.notEqual(bodyStart, 1, `Expected ${name} to have a function body.`);
  let depth = 0;

  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  assert.fail(`Expected ${name} to have a complete function body.`);
}

const normalizeCeilingSource = extractFunction(consumerDetailSource, "normalizeCeiling").replace(
  "function normalizeCeiling(value: number)",
  "function normalizeCeiling(value)",
);
const previewGuardParamSource = consumerDetailSource.match(/const previewGuardParam = "preview";/)?.[0];
assert.ok(previewGuardParamSource, "Expected a stable query marker for shareable guard previews.");
const readPreviewCeilingSource = extractFunction(consumerDetailSource, "readPreviewCeilingFromLocation");
const buildPreviewGuardUrlSource = extractFunction(consumerDetailSource, "buildPreviewGuardUrl").replace(
  "function buildPreviewGuardUrl(ceiling: number)",
  "function buildPreviewGuardUrl(ceiling)",
);
const syncPreviewGuardUrlSource = extractFunction(consumerDetailSource, "syncPreviewGuardUrl").replace(
  "function syncPreviewGuardUrl(ceiling: number)",
  "function syncPreviewGuardUrl(ceiling)",
);
const clearPreviewGuardUrlSource = extractFunction(consumerDetailSource, "clearPreviewGuardUrl");
const projectConsumerGuardSource = extractFunction(consumerDetailSource, "projectConsumerGuard").replace(
  "function projectConsumerGuard(\n  consumer: { spend: number; generations: number; credits: number },\n  ceiling: number,\n)",
  "function projectConsumerGuard(consumer, ceiling)",
);
const formatSessionGuardHandoffSource = extractFunction(consumerDetailSource, "formatSessionGuardHandoff").replace(
  /function formatSessionGuardHandoff\(\{\n  consumer,\n  ceiling,\n  projection,\n\}: \{[\s\S]*?\n\}\) \{/,
  "function formatSessionGuardHandoff({ consumer, ceiling, projection }) {",
);
const guard = new Function(
  "formatCurrency",
  "formatNumber",
  `${normalizeCeilingSource}\n${projectConsumerGuardSource}\n${formatSessionGuardHandoffSource}\nreturn { normalizeCeiling, projectConsumerGuard, formatSessionGuardHandoff };`,
)(
  (value) => `$${value.toFixed(2)}`,
  (value) => String(value),
);

const previewGuard = new Function(
  `${previewGuardParamSource}\n${normalizeCeilingSource}\n${readPreviewCeilingSource}\n${buildPreviewGuardUrlSource}\n${syncPreviewGuardUrlSource}\n${clearPreviewGuardUrlSource}\nreturn { readPreviewCeilingFromLocation, buildPreviewGuardUrl, syncPreviewGuardUrl, clearPreviewGuardUrl };`,
)();

const activationConsumer = { id: "acme", name: "Acme", plan: "Pro", spend: 100, generations: 20, credits: 50 };
const activeCeiling = guard.normalizeCeiling(80);
const activeProjection = guard.projectConsumerGuard(activationConsumer, activeCeiling);
const copiedHandoff = guard.formatSessionGuardHandoff({
  consumer: activationConsumer,
  ceiling: activeCeiling,
  projection: activeProjection,
});
const refetchedConsumer = { ...activationConsumer, spend: 120, generations: 24, credits: 48 };
const laterLiveCeiling = guard.normalizeCeiling(100);
const liveProjectionAfterRefetch = guard.projectConsumerGuard(refetchedConsumer, laterLiveCeiling);
const activeProjectionAfterRefetch = guard.projectConsumerGuard(refetchedConsumer, activeCeiling);
const copiedHandoffAfterRefetch = guard.formatSessionGuardHandoff({
  consumer: refetchedConsumer,
  ceiling: activeCeiling,
  projection: activeProjectionAfterRefetch,
});

assert.deepEqual(activeProjection, { overage: 20, affectedGenerations: 4, remainingCredits: 40 });
assert.deepEqual(liveProjectionAfterRefetch, { overage: 20, affectedGenerations: 4, remainingCredits: 40 });
assert.deepEqual(activeProjectionAfterRefetch, { overage: 40, affectedGenerations: 8, remainingCredits: 32 });
assert.match(copiedHandoff, /account spend reaches \$80\.00/);
assert.match(copiedHandoffAfterRefetch, /account spend reaches \$80\.00/);
assert.match(copiedHandoffAfterRefetch, /over ceiling: \$40\.00/);
assert.match(copiedHandoffAfterRefetch, /8 generation requests held · 32 credits remain/);

const previousWindow = globalThis.window;
const historyWrites = [];
globalThis.window = {
  location: {
    href: "https://signalops.ilyamoskovkin.com/consumers/usr_01?keep=value&ceiling=80&guard=preview#handoff",
    search: "?keep=value&ceiling=80&guard=preview",
  },
  history: {
    replaceState: (_state, _title, url) => {
      const nextUrl = new URL(String(url));
      historyWrites.push(nextUrl.toString());
      globalThis.window.location.href = nextUrl.toString();
      globalThis.window.location.search = nextUrl.search;
    },
  },
};

assert.equal(previewGuard.readPreviewCeilingFromLocation(), 80);
assert.equal(
  previewGuard.buildPreviewGuardUrl(72.5),
  "https://signalops.ilyamoskovkin.com/consumers/usr_01?keep=value&ceiling=72.5&guard=preview",
);
assert.equal(previewGuard.syncPreviewGuardUrl(72.5), historyWrites[0]);
assert.equal(globalThis.window.location.search, "?keep=value&ceiling=72.5&guard=preview");
previewGuard.clearPreviewGuardUrl();
assert.equal(globalThis.window.location.search, "?keep=value");
globalThis.window.location.search = "?ceiling=-1&guard=preview";
assert.equal(previewGuard.readPreviewCeilingFromLocation(), null);
globalThis.window = previousWindow;

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
  /useEffect\(\(\) => \{[\s\S]*?readPreviewCeilingFromLocation\(\)[\s\S]*?setCeilingOverride\(previewCeiling\);[\s\S]*?setSimulatedCeiling\(previewCeiling\);/,
  "Expected an exact preview checkpoint URL to restore only a simulated, never active, guard.",
);
assert.match(
  consumerDetailSource,
  /setSimulatedCeiling\(ceiling\);[\s\S]*?syncPreviewLink\(\);/,
  "Expected an operator preview to keep the address bar synchronized with its exact ceiling.",
);
assert.match(
  consumerDetailSource,
  /setActiveCeiling\(ceiling\);[\s\S]*?clearPreviewLink\(\);/,
  "Expected activating a session-only guard to remove its read-only preview checkpoint URL.",
);
assert.match(
  consumerDetailSource,
  /Shareable checkpoint[\s\S]*?Copy preview link[\s\S]*?never activates a guard or changes billing, credits, or server-side policy/,
  "Expected a keyboard-operable sharing surface with its non-mutating boundary visible.",
);
assert.match(
  consumerDetailSource,
  /previewUrlError[\s\S]*?role="alert"[\s\S]*?Retry link sync/,
  "Expected address-bar synchronization failures to stay visible and retryable.",
);
assert.match(
  consumerDetailSource,
  /const activeHandoff =[\s\S]*?activeCeiling === null[\s\S]*?formatSessionGuardHandoff/,
  "Expected no handoff to exist before a session guard is active.",
);
assert.match(
  consumerDetailSource,
  /disabled=\{guardState !== "simulated"\}[\s\S]*?onClick=\{\(\) => \{[\s\S]*?setActiveCeiling\(ceiling\);/,
  "Expected activation to capture the current normalized ceiling before the live query can change it.",
);
assert.match(
  consumerDetailSource,
  /const projection = useMemo\([\s\S]*?projectConsumerGuard\(consumer, ceiling\)[\s\S]*?\}, \[ceiling, consumer\]\);/,
  "Expected the ordinary live preview to remain reactive to the current ceiling.",
);
assert.match(
  consumerDetailSource,
  /const activeProjection = activeCeiling === null \? null : projectConsumerGuard\(consumer, activeCeiling\);/,
  "Expected an activated handoff to recompute every projected value from its frozen activation ceiling.",
);
assert.match(
  consumerDetailSource,
  /formatSessionGuardHandoff\(\{ consumer, ceiling: activeCeiling, projection: activeProjection \}\)/,
  "Expected a later live query/refetch ceiling change to leave the copied handoff internally consistent.",
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

console.log("Consumer guard handoff contract OK: executed frozen/live transition stays active-only, truthful, versioned, and recoverable.");
