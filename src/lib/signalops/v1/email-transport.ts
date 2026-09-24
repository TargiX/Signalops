import { createTransport } from "nodemailer";

export type SignalOpsEmailMessageV1 = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  /** Stable per logical message; used as the SMTP Message-ID so a retry is recognizable. */
  idempotencyKey: string;
};

export type SignalOpsEmailTransportConfigV1 =
  | { kind: "resend"; apiKey: string }
  | { kind: "smtp"; host: string; port: number; user: string; password: string };

// Resend stays the default so an unset switch never changes live delivery.
export function getSignalOpsEmailTransportConfigV1(): SignalOpsEmailTransportConfigV1 | null {
  const kind = process.env.SIGNALOPS_EMAIL_TRANSPORT?.trim() || "resend";
  if (kind === "resend") {
    const apiKey = process.env.SIGNALOPS_RESEND_API_KEY?.trim();
    return apiKey ? { kind, apiKey } : null;
  }
  if (kind !== "smtp") return null;
  const host = process.env.SIGNALOPS_SMTP_HOST?.trim();
  const port = Number(process.env.SIGNALOPS_SMTP_PORT?.trim() || "465");
  const user = process.env.SIGNALOPS_SMTP_USER?.trim();
  const password = process.env.SIGNALOPS_SMTP_PASSWORD;
  if (!host || !user || !password || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }
  return { kind, host, port, user, password };
}

export function isSignalOpsEmailTransportConfiguredV1(): boolean {
  return Boolean(getSignalOpsEmailTransportConfigV1());
}

function messageIdFor(message: SignalOpsEmailMessageV1): string | undefined {
  const domain = /@([A-Za-z0-9.-]+)>?\s*$/u.exec(message.from)?.[1];
  const key = message.idempotencyKey.replace(/[^A-Za-z0-9_.-]/gu, "");
  return domain && key ? `<${key}@${domain}>` : undefined;
}

async function sendWithResend(apiKey: string, message: SignalOpsEmailMessageV1): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      reply_to: message.replyTo,
      subject: message.subject,
      text: message.text,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Email provider rejected delivery (${response.status})`);
}

async function sendWithSmtp(
  config: Extract<SignalOpsEmailTransportConfigV1, { kind: "smtp" }>,
  message: SignalOpsEmailMessageV1,
): Promise<void> {
  // 465 is implicit TLS; any other port must upgrade with STARTTLS or the send fails before AUTH.
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: true,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    await transport.sendMail({
      from: message.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      messageId: messageIdFor(message),
    });
  } finally {
    transport.close();
  }
}

// No cross-provider fallback: an SMTP timeout is ambiguous (the server may already have
// accepted the message), so retrying through Resend could deliver twice.
export async function sendSignalOpsEmailV1(message: SignalOpsEmailMessageV1): Promise<boolean> {
  const config = getSignalOpsEmailTransportConfigV1();
  if (!config) return false;
  if (config.kind === "resend") await sendWithResend(config.apiKey, message);
  else await sendWithSmtp(config, message);
  return true;
}
