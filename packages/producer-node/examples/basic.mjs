import {
  createSignalOpsHttpTransportV1,
  createSignalOpsProducerV1,
} from "../dist/index.js";

const transport = createSignalOpsHttpTransportV1({
  endpoint: process.env.SIGNALOPS_ENDPOINT ?? "https://signalops.cc/v1/events",
  getCredential: () => {
    const credential = process.env.SIGNALOPS_INGEST_CREDENTIAL;
    if (!credential) throw new Error("SIGNALOPS_INGEST_CREDENTIAL is required");
    return credential;
  },
  onDeadLetter: ({ events, reason }) => {
    console.error("SignalOps delivery requires attention", {
      eventIds: events.map((event) => event.id),
      reason,
    });
  },
});

const signalOps = createSignalOpsProducerV1({
  source: "https://product.example/generation-worker",
  resource: {
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    service: "generation-worker",
    release: process.env.APP_RELEASE ?? "local",
  },
  transport,
});

const operation = signalOps.startOperation({
  operation: {
    id: "opaque-operation-123",
    kind: "image_generation",
    logicalModelKey: "image-balanced",
  },
});
const attempt = operation.startAttempt({
  attempt: { id: "opaque-attempt-123", number: 1 },
  route: {
    providerKey: "primary-images",
    providerVendor: "openai",
    modelKey: "image-balanced",
    providerModelKey: "gpt-image-2",
  },
});
attempt.succeed({
  metrics: { outputUnits: 1 },
  cost: { amount: "0.04", currency: "USD", source: "provider_reported" },
});
operation.succeed();

await signalOps.close();
