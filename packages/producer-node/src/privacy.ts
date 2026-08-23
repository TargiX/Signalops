import type {
  SignalOpsAttributesV1,
  SignalOpsFailureCategoryV1,
  SignalOpsFailureResponsibilityV1,
  SignalOpsFailureV1,
} from "@signalops/contracts/v1";

const forbiddenKeyTokens = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "credentials",
  "email",
  "errormessage",
  "externalrequestid",
  "imageurl",
  "ip",
  "mediaurl",
  "prompt",
  "promptlength",
  "prompttext",
  "providerapikey",
  "rawerror",
  "referenceimageurl",
  "referenceimageurls",
  "stack",
  "token",
  "user",
  "userid",
]);

const failureCategories = new Set<SignalOpsFailureCategoryV1>([
  "provider_capacity",
  "provider_rate_limit",
  "provider_auth",
  "provider_rejected",
  "provider_timeout",
  "provider_error",
  "content_policy",
  "invalid_input",
  "customer_cancelled",
  "client_configuration",
  "application_error",
  "postprocessing_error",
  "storage_error",
  "unknown",
]);

const failureResponsibilities = new Set<SignalOpsFailureResponsibilityV1>([
  "provider",
  "customer",
  "client",
  "platform",
  "unknown",
]);

const attributeKeyPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const failureCodePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const emailPattern = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u;
const authorizationPattern = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/iu;
const urlPattern = /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/u;
const ipv4Pattern = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/u;

function safeAttributeValue(value: unknown): value is string | number | boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return (
    typeof value === "string" &&
    value.length <= 240 &&
    !emailPattern.test(value) &&
    !authorizationPattern.test(value) &&
    !urlPattern.test(value) &&
    !ipv4Pattern.test(value)
  );
}

export function sanitizeSignalOpsAttributesV1(
  input: unknown,
): { attributes?: SignalOpsAttributesV1; droppedKeys: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { droppedKeys: input === undefined ? [] : ["<attributes>"] };
  }

  const attributes: SignalOpsAttributesV1 = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(input).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const normalizedKey = key.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
    if (
      Object.keys(attributes).length >= 20 ||
      !attributeKeyPattern.test(key) ||
      forbiddenKeyTokens.has(normalizedKey) ||
      !safeAttributeValue(value)
    ) {
      droppedKeys.push(key);
      continue;
    }
    attributes[key] = value;
  }

  return {
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    droppedKeys,
  };
}

export function normalizeSignalOpsFailureV1(input: unknown): SignalOpsFailureV1 {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const category = failureCategories.has(value.category as SignalOpsFailureCategoryV1)
    ? value.category as SignalOpsFailureCategoryV1
    : "unknown";
  const responsibility = failureResponsibilities.has(
    value.responsibility as SignalOpsFailureResponsibilityV1,
  )
    ? value.responsibility as SignalOpsFailureResponsibilityV1
    : "unknown";
  const code = typeof value.code === "string" && failureCodePattern.test(value.code)
    ? value.code
    : undefined;
  const retryable = typeof value.retryable === "boolean" ? value.retryable : undefined;

  return {
    category,
    responsibility,
    ...(code ? { code } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
  };
}
