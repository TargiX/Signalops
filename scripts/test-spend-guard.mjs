import assert from "node:assert/strict";
import { buildSpendGuard } from "../src/lib/spend-guard.ts";
import { getOpsSnapshot } from "../src/lib/mock-data.ts";

const snapshot = getOpsSnapshot("24h");
const findings = buildSpendGuard(snapshot);

assert.equal(findings.length, snapshot.providers.length);
assert.equal(findings[0]?.providerId, "fal");
assert.equal(findings[0]?.highestCostModel, "FLUX 2 Max");
assert.equal(findings[0]?.incidentId, "inc_409");
assert.equal(findings[0]?.recoverableSpend, 18.3008);
assert.equal(Number(findings[0]?.costPerSuccessfulGeneration.toFixed(3)), 0.38);

const alibaba = findings.find((finding) => finding.providerId === "alibaba");
assert.equal(alibaba?.providerName, "Alibaba");
assert.equal(alibaba?.providerStatus, "incident");
assert.equal(alibaba?.highestCostModel, "Qwen Image");
assert.equal(Number(alibaba?.costPerSuccessfulGeneration.toFixed(3)), 0.353);
assert.equal(Number(alibaba?.recoverableSpend.toFixed(5)), 8.40385);
assert.equal(alibaba?.failureRate, 9.1);
assert.equal(alibaba?.incidentId, "inc_411");

console.log("Spend guard contract OK: ranks recoverable spend and retains incident context.");
