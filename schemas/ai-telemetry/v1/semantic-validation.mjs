function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate cross-field invariants that JSON Schema draft 2020-12 cannot express.
 * This module is part of the portable v1 contract artifact and must travel with
 * the schema and fixtures.
 */
export function validateSignalOpsEventSemanticsV1(input) {
  if (!isRecord(input) || typeof input.type !== "string" || typeof input.subject !== "string") {
    return [];
  }

  const data = isRecord(input.data) ? input.data : undefined;
  if (!data) return [];

  let expectedSubject;
  if (input.type === "com.signalops.ai.provider.probe.v1") {
    const route = isRecord(data.route) ? data.route : undefined;
    if (route && typeof route.providerKey === "string") {
      expectedSubject = `provider/${route.providerKey}`;
    }
  } else if (input.type.startsWith("com.signalops.ai.")) {
    const operation = isRecord(data.operation) ? data.operation : undefined;
    if (operation && typeof operation.id === "string") {
      expectedSubject = `operation/${operation.id}`;
    }
  }

  if (expectedSubject === undefined || input.subject === expectedSubject) return [];

  return [
    {
      instancePath: "/subject",
      keyword: "identity",
      message: `must equal ${expectedSubject}`,
    },
  ];
}
