import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import eventSchema from "../../../../schemas/ai-telemetry/v1/event.schema.json" with { type: "json" };
import { validateSignalOpsEventSemanticsV1 } from "../../../../schemas/ai-telemetry/v1/semantic-validation.mjs";
import type {
  SignalOpsContractIssueV1,
  SignalOpsEventV1,
  SignalOpsEventValidationResultV1,
} from "./types.ts";

export const SIGNALOPS_V1_LIMITS = {
  maxBatchEvents: 100,
  maxBodyBytes: 256 * 1024,
} as const;

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validateSchema = ajv.compile<SignalOpsEventV1>(eventSchema);

const forbiddenKeyTokens = [
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
] as const;

const forbiddenKeySet = new Set<string>(forbiddenKeyTokens);
const emailPattern = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const authorizationPattern = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/i;
const urlPattern = /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/;
const ipv4Pattern = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issueFromAjv(error: ErrorObject): SignalOpsContractIssueV1 {
  return {
    instancePath: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message ?? "contract validation failed",
  };
}

function privacyIssues(value: unknown, path = ""): SignalOpsContractIssueV1[] {
  if (typeof value === "string") {
    const issues: SignalOpsContractIssueV1[] = [];
    if (emailPattern.test(value)) {
      issues.push({
        instancePath: path || "/",
        keyword: "privacy",
        message: "email-like values are forbidden",
      });
    }
    if (authorizationPattern.test(value)) {
      issues.push({
        instancePath: path || "/",
        keyword: "privacy",
        message: "authorization-like values are forbidden",
      });
    }
    if (path.startsWith("/data/attributes/") && urlPattern.test(value)) {
      issues.push({
        instancePath: path,
        keyword: "privacy",
        message: "URL-like attribute values are forbidden",
      });
    }
    if (ipv4Pattern.test(value)) {
      issues.push({
        instancePath: path || "/",
        keyword: "privacy",
        message: "IP-like values are forbidden",
      });
    }
    return issues;
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => privacyIssues(entry, `${path}/${index}`));
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, entry]) => {
    const entryPath = `${path}/${key}`;
    const normalizedKey = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
    const keyIssues = forbiddenKeySet.has(normalizedKey)
      ? [
          {
            instancePath: entryPath,
            keyword: "privacy",
            message: `field ${key} is forbidden`,
          } satisfies SignalOpsContractIssueV1,
        ]
      : [];

    return [...keyIssues, ...privacyIssues(entry, entryPath)];
  });
}

function cloneEvent(event: SignalOpsEventV1): SignalOpsEventV1 {
  return structuredClone(event);
}

export function validateSignalOpsEventV1(input: unknown): SignalOpsEventValidationResultV1 {
  const schemaAccepted = validateSchema(input);
  const issues = [
    ...(schemaAccepted ? [] : (validateSchema.errors ?? []).map(issueFromAjv)),
    ...validateSignalOpsEventSemanticsV1(input),
    ...privacyIssues(input),
  ];

  if (!schemaAccepted || issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, event: cloneEvent(input) };
}

export type SignalOpsBatchRejectionV1 = {
  index: number;
  issues: SignalOpsContractIssueV1[];
};

export type SignalOpsNormalizedBatchV1 = {
  events: SignalOpsEventV1[];
  rejected: SignalOpsBatchRejectionV1[];
};

export function normalizeSignalOpsEventBatchV1(
  input: unknown,
  options: { maxBatchEvents?: number } = {},
): SignalOpsNormalizedBatchV1 {
  const maxBatchEvents = options.maxBatchEvents ?? SIGNALOPS_V1_LIMITS.maxBatchEvents;
  let rawEvents: unknown[];
  if (Array.isArray(input)) {
    rawEvents = input;
  } else if (isRecord(input) && Array.isArray(input.events)) {
    const unexpectedKeys = Object.keys(input).filter((key) => key !== "events");
    if (unexpectedKeys.length > 0) {
      throw new TypeError(`batch envelope contains unsupported fields: ${unexpectedKeys.join(", ")}`);
    }
    rawEvents = input.events;
  } else {
    rawEvents = [input];
  }

  if (rawEvents.length > maxBatchEvents) {
    throw new RangeError(`event batches are limited to ${maxBatchEvents} events`);
  }

  const events: SignalOpsEventV1[] = [];
  const rejected: SignalOpsBatchRejectionV1[] = [];

  rawEvents.forEach((rawEvent, index) => {
    const result = validateSignalOpsEventV1(rawEvent);
    if (result.ok) {
      events.push(result.event);
    } else {
      rejected.push({ index, issues: result.issues });
    }
  });

  return { events, rejected };
}

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForCanonicalJson);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortForCanonicalJson(value[key])]),
  );
}

export function canonicalSignalOpsEventTextV1(event: SignalOpsEventV1): string {
  return JSON.stringify(sortForCanonicalJson(event));
}
