import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchCsvDownload } from "../src/lib/csv-download.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const dashboardPath = path.join(repoRoot, "src/components/dashboard.tsx");

function createDownloadHarness(overrides = {}) {
  const calls = [];
  const anchor = { href: "", download: "" };
  let scheduledCleanup = null;

  return {
    calls,
    get scheduledCleanup() {
      return scheduledCleanup;
    },
    dependencies: {
      createBlob: (parts, options) => {
        calls.push(["blob", parts, options]);
        return {};
      },
      createObjectUrl: () => {
        calls.push(["create-object-url"]);
        return "blob:signalops-export";
      },
      revokeObjectUrl: (url) => calls.push(["revoke-object-url", url]),
      createAnchor: () => {
        calls.push(["create-anchor"]);
        return anchor;
      },
      appendAnchor: () => calls.push(["append-anchor"]),
      clickAnchor: () => calls.push(["click-anchor"]),
      removeAnchor: () => calls.push(["remove-anchor"]),
      scheduleCleanup: (callback) => {
        calls.push(["schedule-cleanup"]);
        scheduledCleanup = callback;
      },
      ...overrides,
    },
  };
}

function assertFailedDispatch(label, overrides, expectedCalls) {
  const harness = createDownloadHarness(overrides);
  const result = dispatchCsvDownload("snapshot.csv", "section,value", harness.dependencies);

  assert.equal(result.dispatched, false, `${label} should report a failed dispatch.`);
  assert.deepEqual(harness.calls, expectedCalls, `${label} should clean up created resources.`);
}

assertFailedDispatch(
  "Blob creation failure",
  {
    createBlob: () => {
      throw new Error("Blob blocked");
    },
  },
  [],
);

assertFailedDispatch(
  "Object URL creation failure",
  {
    createObjectUrl: () => {
      throw new Error("URL blocked");
    },
  },
  [["blob", ["\uFEFFsection,value"], { type: "text/csv;charset=utf-8" }]],
);

assertFailedDispatch(
  "Anchor creation failure",
  {
    createAnchor: () => {
      throw new Error("Anchor blocked");
    },
  },
  [
    ["blob", ["\uFEFFsection,value"], { type: "text/csv;charset=utf-8" }],
    ["create-object-url"],
    ["revoke-object-url", "blob:signalops-export"],
  ],
);

assertFailedDispatch(
  "Anchor append failure",
  {
    appendAnchor: () => {
      throw new Error("Append blocked");
    },
  },
  [
    ["blob", ["\uFEFFsection,value"], { type: "text/csv;charset=utf-8" }],
    ["create-object-url"],
    ["create-anchor"],
    ["remove-anchor"],
    ["revoke-object-url", "blob:signalops-export"],
  ],
);

assertFailedDispatch(
  "Anchor click failure",
  {
    clickAnchor: () => {
      throw new Error("Click blocked");
    },
  },
  [
    ["blob", ["\uFEFFsection,value"], { type: "text/csv;charset=utf-8" }],
    ["create-object-url"],
    ["create-anchor"],
    ["append-anchor"],
    ["remove-anchor"],
    ["revoke-object-url", "blob:signalops-export"],
  ],
);

assertFailedDispatch(
  "Anchor removal failure",
  {
    removeAnchor: () => {
      throw new Error("Remove blocked");
    },
  },
  [
    ["blob", ["\uFEFFsection,value"], { type: "text/csv;charset=utf-8" }],
    ["create-object-url"],
    ["create-anchor"],
    ["append-anchor"],
    ["click-anchor"],
    ["revoke-object-url", "blob:signalops-export"],
  ],
);

assertFailedDispatch(
  "Cleanup scheduling failure",
  {
    scheduleCleanup: () => {
      throw new Error("Timer blocked");
    },
  },
  [
    ["blob", ["\uFEFFsection,value"], { type: "text/csv;charset=utf-8" }],
    ["create-object-url"],
    ["create-anchor"],
    ["append-anchor"],
    ["click-anchor"],
    ["remove-anchor"],
    ["revoke-object-url", "blob:signalops-export"],
  ],
);

const successful = createDownloadHarness();
const successfulResult = dispatchCsvDownload(
  "snapshot.csv",
  "section,value",
  successful.dependencies,
);
assert.deepEqual(successfulResult, { dispatched: true });
assert.deepEqual(successful.calls, [
  ["blob", ["\uFEFFsection,value"], { type: "text/csv;charset=utf-8" }],
  ["create-object-url"],
  ["create-anchor"],
  ["append-anchor"],
  ["click-anchor"],
  ["remove-anchor"],
  ["schedule-cleanup"],
]);
assert.ok(successful.scheduledCleanup, "Successful dispatch should schedule object URL cleanup.");
successful.scheduledCleanup();
assert.deepEqual(successful.calls.at(-1), [
  "revoke-object-url",
  "blob:signalops-export",
]);

const failedAttempt = createDownloadHarness({
  clickAnchor: () => {
    throw new Error("Click blocked once");
  },
});
const retryAttempt = createDownloadHarness();
assert.equal(
  dispatchCsvDownload("snapshot.csv", "section,value", failedAttempt.dependencies)
    .dispatched,
  false,
);
assert.equal(
  dispatchCsvDownload("snapshot.csv", "section,value", retryAttempt.dependencies)
    .dispatched,
  true,
  "A fresh retry should remain independently dispatchable after a failure.",
);
assert.equal(
  retryAttempt.calls.filter(([name]) => name === "click-anchor").length,
  1,
  "A fresh retry should dispatch exactly once.",
);

const dashboardSource = await readFile(dashboardPath, "utf8");
const exportHandlerStart = dashboardSource.indexOf("function handleExport()");
const exportHandlerEnd = dashboardSource.indexOf("\n  if (isLoading", exportHandlerStart);
const exportHandler = dashboardSource.slice(exportHandlerStart, exportHandlerEnd);
const exportButton = dashboardSource.slice(
  dashboardSource.indexOf("<motion.button", dashboardSource.indexOf("onClick={handleExport}")),
  dashboardSource.indexOf("</motion.button>", dashboardSource.indexOf("onClick={handleExport}")),
);

assert.match(
  dashboardSource,
  /const \[exportError, setExportError\] = useState<string \| null>\(null\)/,
  "Dashboard should retain only export failure feedback as new export state.",
);
assert.ok(
  exportHandler.indexOf("setExportError(null)") < exportHandler.indexOf("dispatchCsvDownload"),
  "A fresh export attempt should clear stale feedback before dispatch.",
);
assert.match(
  exportHandler,
  /if \(!exportResult\.dispatched\) \{\s*setExportError\("Export did not start\. Try again\."\);\s*\}/,
  "A synchronous helper failure should set visible retry feedback.",
);
assert.match(
  dashboardSource,
  /<p\s+role="alert"[\s\S]*?\{exportError\}[\s\S]*?<\/p>/,
  "Dashboard should expose failure feedback through an accessible alert.",
);
assert.doesNotMatch(
  exportButton,
  /\bdisabled\b/,
  "Export must remain actionable for a fresh retry.",
);
assert.doesNotMatch(
  exportHandler,
  /set(?:SelectedIncidentId|ReplayScenarioId|ReplayStepIndex|SavedView|ProviderView|ModelView|QueueFocusProviderId|QueueFocusStatus|TriggerMode|TrafficShare|SelectedGeneration)\(/,
  "An export failure must not mutate replay, selection, or dashboard control state.",
);

console.log(
  "CSV download contracts OK: synchronous cleanup failures are retryable and Dashboard feedback stays accessible without mutating replay state.",
);
