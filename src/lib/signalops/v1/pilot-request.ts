import { createHmac } from "node:crypto";

export type SignalOpsPilotRequestV1 = {
  email: string;
  company: string;
  role: string | null;
  category: "observability" | "reliability" | "cost" | "migration" | "other";
  monthlyOperations: "under_10k" | "10k_100k" | "100k_1m" | "over_1m" | "unknown";
  useCase: string;
  sourcePath: string;
};

const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const categories = new Set<SignalOpsPilotRequestV1["category"]>([
  "observability",
  "reliability",
  "cost",
  "migration",
  "other",
]);
const volumes = new Set<SignalOpsPilotRequestV1["monthlyOperations"]>([
  "under_10k",
  "10k_100k",
  "100k_1m",
  "over_1m",
  "unknown",
]);

function boundedText(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== "string" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${field} is invalid`);
  }
  const text = value.trim().replace(/[\t ]+/g, " ");
  if (text.length < minimum || text.length > maximum) {
    throw new TypeError(`${field} must be ${minimum}-${maximum} characters`);
  }
  return text;
}

export function normalizeSignalOpsPilotRequestV1(value: unknown): SignalOpsPilotRequestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Pilot request must be an object");
  }
  const input = value as Record<string, unknown>;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!emailPattern.test(email)) throw new TypeError("A valid work email is required");
  const company = boundedText(input.company, "Company", 2, 120);
  const role = input.role ? boundedText(input.role, "Role", 2, 120) : null;
  if (!categories.has(input.category as SignalOpsPilotRequestV1["category"])) {
    throw new TypeError("Pilot request category is invalid");
  }
  if (!volumes.has(input.monthlyOperations as SignalOpsPilotRequestV1["monthlyOperations"])) {
    throw new TypeError("Monthly operation volume is invalid");
  }
  const useCase = boundedText(input.useCase, "Use case", 10, 2_000);
  const rawSourcePath = typeof input.sourcePath === "string" ? input.sourcePath : "";
  const pathOnly = rawSourcePath.split(/[?#]/u, 1)[0] ?? "";
  const sourcePath =
    pathOnly.startsWith("/") &&
    !pathOnly.startsWith("//") &&
    /^\/[A-Za-z0-9_/.-]{0,240}$/.test(pathOnly)
      ? pathOnly
      : "/contact";
  return {
    email,
    company,
    role,
    category: input.category as SignalOpsPilotRequestV1["category"],
    monthlyOperations: input.monthlyOperations as SignalOpsPilotRequestV1["monthlyOperations"],
    useCase,
    sourcePath,
  };
}

function pilotRequestText(request: SignalOpsPilotRequestV1, requestId: string): string {
  return [
    "New SignalOps beta request",
    "",
    `Request: ${requestId}`,
    `Company: ${request.company}`,
    `Email: ${request.email}`,
    `Role: ${request.role ?? "not provided"}`,
    `Goal: ${request.category}`,
    `Monthly AI operations: ${request.monthlyOperations}`,
    `Source: ${request.sourcePath}`,
    "",
    "Use case:",
    request.useCase,
  ].join("\n");
}

async function deliverWebhook(
  request: SignalOpsPilotRequestV1,
  requestId: string,
): Promise<boolean> {
  const configuredUrl = process.env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL?.trim();
  const secret = process.env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_SECRET?.trim();
  if (!configuredUrl || !secret || secret.length < 32) return false;
  const url = new URL(configuredUrl);
  if (url.protocol !== "https:") throw new Error("Pilot request webhook must use HTTPS");
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const body = JSON.stringify({
    version: "signalops.pilot-request.v1",
    requestId,
    submittedAt: new Date().toISOString(),
    request,
  });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signalops-request-id": requestId,
      "x-signalops-timestamp": timestamp,
      "x-signalops-signature": `sha256=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Pilot request webhook rejected delivery (${response.status})`);
  return true;
}

async function deliverEmail(
  request: SignalOpsPilotRequestV1,
  requestId: string,
): Promise<boolean> {
  const apiKey = process.env.SIGNALOPS_RESEND_API_KEY?.trim();
  const to = process.env.SIGNALOPS_PILOT_REQUEST_EMAIL_TO?.trim();
  const from = process.env.SIGNALOPS_PILOT_REQUEST_EMAIL_FROM?.trim();
  if (!apiKey || !to || !from) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: request.email,
      subject: `[SignalOps beta] ${request.company} · ${request.category}`,
      text: pilotRequestText(request, requestId),
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Pilot request email rejected delivery (${response.status})`);
  return true;
}

export async function deliverSignalOpsPilotRequestV1(
  request: SignalOpsPilotRequestV1,
  requestId: string,
): Promise<"webhook" | "email"> {
  let webhookError: unknown;
  try {
    if (await deliverWebhook(request, requestId)) return "webhook";
  } catch (error) {
    webhookError = error;
  }
  try {
    if (await deliverEmail(request, requestId)) return "email";
  } catch (error) {
    if (webhookError) {
      throw new AggregateError(
        [webhookError, error],
        "Pilot request webhook and email delivery both failed",
      );
    }
    throw error;
  }
  if (webhookError) throw webhookError;
  throw new Error("Pilot request delivery is not configured");
}
