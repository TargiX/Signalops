import assert from "node:assert/strict";

import {
  authorizeSignalOpsCronRequestV1,
  isSignalOpsCronAuthConfiguredV1,
} from "../src/lib/signalops/v1/internal-auth.ts";

// The cron bearer gate guards /api/internal/evaluate and /api/readiness —
// the only endpoints that accept a shared secret over the public origin.
// These contracts pin the env precedence, the 32-char floor, the trimming
// rules, and the Bearer header shape so a config regression cannot silently
// open (or wedge) the scheduled evaluator.

const CRON = "c".repeat(32);
const FALLBACK = "f".repeat(40);

function bearer(token) {
  return new Request("https://signalops.example/api/internal/evaluate", {
    headers: { authorization: `Bearer ${token}` },
  });
}

const saved = { ...process.env };
try {
  const setEnv = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  // --- isSignalOpsCronAuthConfiguredV1 ---

  setEnv("CRON_SECRET", undefined);
  setEnv("SIGNALOPS_CRON_SECRET", undefined);
  assert.equal(isSignalOpsCronAuthConfiguredV1(), false, "unconfigured must read as not configured");

  setEnv("CRON_SECRET", "");
  assert.equal(isSignalOpsCronAuthConfiguredV1(), false, "empty secret is not configured");

  setEnv("CRON_SECRET", "   ");
  assert.equal(isSignalOpsCronAuthConfiguredV1(), false, "whitespace-only secret is not configured");

  setEnv("CRON_SECRET", "a".repeat(31));
  assert.equal(isSignalOpsCronAuthConfiguredV1(), false, "31 chars is below the 32-char floor");

  setEnv("CRON_SECRET", "a".repeat(32));
  assert.equal(isSignalOpsCronAuthConfiguredV1(), true, "exactly 32 chars is configured");

  // SIGNALOPS_CRON_SECRET is the documented fallback name.
  setEnv("CRON_SECRET", undefined);
  setEnv("SIGNALOPS_CRON_SECRET", FALLBACK);
  assert.equal(isSignalOpsCronAuthConfiguredV1(), true, "fallback secret name is honored");

  // CRON_SECRET wins when both are set — even if it is too short.
  setEnv("CRON_SECRET", "short");
  setEnv("SIGNALOPS_CRON_SECRET", FALLBACK);
  assert.equal(
    isSignalOpsCronAuthConfiguredV1(),
    false,
    "short CRON_SECRET must not be masked by a long fallback",
  );

  // Trimming counts: 30 visible chars + padding is still below the floor,
  // but 30 visible chars plus enough padding to clear 32 after trim is fine.
  setEnv("CRON_SECRET", `  ${"a".repeat(30)}  `);
  setEnv("SIGNALOPS_CRON_SECRET", undefined);
  assert.equal(isSignalOpsCronAuthConfiguredV1(), false, "padding cannot fake the 32-char floor");

  setEnv("CRON_SECRET", ` ${"a".repeat(32)} `);
  assert.equal(isSignalOpsCronAuthConfiguredV1(), true, "trimmed secret at 32 chars is configured");

  // --- authorizeSignalOpsCronRequestV1 ---

  // No secret configured: a plausible Bearer header must be rejected.
  setEnv("CRON_SECRET", undefined);
  setEnv("SIGNALOPS_CRON_SECRET", undefined);
  assert.equal(authorizeSignalOpsCronRequestV1(bearer(CRON)), false, "no secret configured -> reject");

  // Short secret: matching token is still rejected.
  setEnv("CRON_SECRET", "short");
  assert.equal(
    authorizeSignalOpsCronRequestV1(bearer("short")),
    false,
    "sub-floor secret rejects even a matching token",
  );

  // Configured secret: header-shape contracts.
  setEnv("CRON_SECRET", CRON);
  setEnv("SIGNALOPS_CRON_SECRET", undefined);
  assert.equal(authorizeSignalOpsCronRequestV1(bearer(CRON)), true, "exact Bearer token is accepted");
  assert.equal(authorizeSignalOpsCronRequestV1(new Request("https://x")), false, "missing header rejects");
  assert.equal(
    authorizeSignalOpsCronRequestV1(
      new Request("https://x", { headers: { authorization: `Basic ${CRON}` } }),
    ),
    false,
    "non-Bearer scheme rejects",
  );
  assert.equal(
    authorizeSignalOpsCronRequestV1(
      new Request("https://x", { headers: { authorization: `bearer ${CRON}` } }),
    ),
    false,
    "scheme is case-sensitive",
  );
  assert.equal(
    authorizeSignalOpsCronRequestV1(
      new Request("https://x", { headers: { authorization: "Bearer " } }),
    ),
    false,
    "empty token rejects",
  );
  assert.equal(authorizeSignalOpsCronRequestV1(bearer("c".repeat(31))), false, "wrong token rejects");
  assert.equal(
    authorizeSignalOpsCronRequestV1(bearer(CRON.toUpperCase())),
    false,
    "token comparison is exact",
  );
  assert.equal(
    authorizeSignalOpsCronRequestV1(bearer(`  ${CRON}  `)),
    true,
    "token whitespace is trimmed before comparison",
  );

  // Env-side whitespace: the stored secret is trimmed, so the clean token matches.
  setEnv("CRON_SECRET", ` ${CRON} `);
  assert.equal(authorizeSignalOpsCronRequestV1(bearer(CRON)), true, "stored-secret whitespace is trimmed");

  // Precedence under authorization: CRON_SECRET wins, fallback cannot authenticate.
  setEnv("CRON_SECRET", CRON);
  setEnv("SIGNALOPS_CRON_SECRET", FALLBACK);
  assert.equal(authorizeSignalOpsCronRequestV1(bearer(CRON)), true, "primary secret authorizes");
  assert.equal(
    authorizeSignalOpsCronRequestV1(bearer(FALLBACK)),
    false,
    "fallback secret must not authorize while CRON_SECRET is set",
  );

  // Fallback path: with CRON_SECRET unset, SIGNALOPS_CRON_SECRET authorizes.
  setEnv("CRON_SECRET", undefined);
  setEnv("SIGNALOPS_CRON_SECRET", FALLBACK);
  assert.equal(authorizeSignalOpsCronRequestV1(bearer(FALLBACK)), true, "fallback secret authorizes");
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(saved)) {
    process.env[key] = value;
  }
}

console.log("test-internal-auth: ok");
