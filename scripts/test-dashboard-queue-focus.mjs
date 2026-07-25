import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dashboardPath = path.join(scriptDir, "..", "src/components/dashboard.tsx");
const dashboardSource = await readFile(dashboardPath, "utf8");

assert.match(
  dashboardSource,
  /const queueRef = useRef<HTMLDivElement \| null>\(null\);/,
  "Expected the cockpit to retain a direct reference to the Generation Queue.",
);

const queueFocusStart = dashboardSource.indexOf("onFocusQueue={() => {");
const queueFocusEnd = dashboardSource.indexOf("onIncidentSelect=", queueFocusStart);
const queueFocusHandler = dashboardSource.slice(queueFocusStart, queueFocusEnd);

assert.ok(queueFocusStart >= 0 && queueFocusEnd > queueFocusStart);
assert.match(
  queueFocusHandler,
  /setSavedView\("triage"\);[\s\S]*?setQueueFocusProviderId\(selectedProvider\.id\);[\s\S]*?setQueueFocusStatus\("all"\);/,
  "Queue focus must keep the selected provider's full triage context.",
);
assert.match(
  queueFocusHandler,
  /requestAnimationFrame\(\(\) => \{[\s\S]*?queueRef\.current\?\.scrollIntoView\(\{ block: "start" \}\);[\s\S]*?queueRef\.current\?\.focus\(\{ preventScroll: true \}\);/,
  "Queue focus must move both the viewport and keyboard focus to the filtered queue.",
);
assert.match(
  dashboardSource,
  /<div[\s\S]*?id="replay-queue"[\s\S]*?ref=\{queueRef\}[\s\S]*?tabIndex=\{-1\}[\s\S]*?aria-label="Generation Queue"/,
  "The queue target must remain a programmatically focusable, named landmark.",
);

console.log("Dashboard queue focus contract OK: triage filter, scroll target, and keyboard focus.");
