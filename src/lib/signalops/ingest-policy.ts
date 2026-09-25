export type SignalOpsIngestPolicy = {
  maxBatchEvents: number;
  maxBodyBytes: number;
  maxBodyKb: number;
  privacyMode: "redact" | "raw";
};

export const DEFAULT_SIGNALOPS_INGEST_POLICY = {
  maxBatchEvents: 100,
  maxBodyBytes: 256 * 1024,
} as const;

function readBoundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

export function readSignalOpsIngestPolicy(
  env: NodeJS.ProcessEnv =
    process.env,
): SignalOpsIngestPolicy {
  const maxBatchEvents = readBoundedInteger(
    env.SIGNALOPS_MAX_BATCH_EVENTS,
    DEFAULT_SIGNALOPS_INGEST_POLICY.maxBatchEvents,
    1,
    1000,
  );
  const maxBodyBytes = readBoundedInteger(
    env.SIGNALOPS_MAX_BODY_BYTES,
    DEFAULT_SIGNALOPS_INGEST_POLICY.maxBodyBytes,
    1024,
    1024 * 1024,
  );

  return {
    maxBatchEvents,
    maxBodyBytes,
    maxBodyKb: Math.round(maxBodyBytes / 1024),
    privacyMode: env.SIGNALOPS_EVENT_PRIVACY_MODE === "raw" ? "raw" : "redact",
  };
}
