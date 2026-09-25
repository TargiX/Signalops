#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { createSignalOpsClient, SignalOpsHttpError, type SignalOpsEvent } from "./index.js";

type CliEnv = Record<string, string | undefined>;
type CliIo = {
  log: (message?: unknown, ...optionalParams: unknown[]) => void;
  error: (message?: unknown, ...optionalParams: unknown[]) => void;
};

type ParsedArgs = {
  command?: string;
  flags: Map<string, string | true>;
};

function usage() {
  return `SignalOps CLI

Usage:
  signalops source-kit [options]
  signalops validate-events --file <path|-> [options]
  signalops verify-source [options]
  signalops source-report [options]

Options:
  --endpoint <url>          SignalOps base URL. Defaults to SIGNALOPS_BASE_URL or https://signalops.cc.
  --file <path|->           Event JSON file for validate-events. Use - for stdin.
  --token <token>           Workspace ingest token. Defaults to SIGNALOPS_INGEST_TOKEN.
  --operator-token <token>  Operator API token for protected reports. Defaults to SIGNALOPS_OPERATOR_TOKEN.
  --allow-storage-gate      Treat 503 setup gates as successful pre-cutover smoke checks.
  --provider <id>           Provider id for verification events. Defaults to SIGNALOPS_VERIFY_PROVIDER or verify-provider.
  --model <id>              Model id for verification events. Defaults to SIGNALOPS_VERIFY_MODEL or verify-model.
  --source <name>           Source label for verification events. Defaults to SIGNALOPS_VERIFY_SOURCE or verify-source.
  --generation <id>         Generation id for idempotent reruns.
  --range <all|24h|7d|30d>  Source report window. Defaults to all.
  --event-id <id>           Exact event id for verify-source or source-report receipt lookup.
  --provider-id <id>        Source report provider filter.
  --model-id <id>           Source report model filter.
  --limit <number>          Source report event read limit. Defaults to 500.
  --format <json|markdown|csv>
                             Source report output format. Defaults to json.
  --help                    Show this help.
`;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const [name, inlineValue] = arg.split("=", 2) as [string, string | undefined];
    if (name === "--help" || name === "--allow-storage-gate") {
      flags.set(name, true);
      continue;
    }

    const next = inlineValue ?? argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }

    flags.set(name, next);
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return { command: positional[0], flags };
}

function readFlag(flags: Map<string, string | true>, name: string) {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function endpointFrom(flags: Map<string, string | true>, env: CliEnv) {
  return (readFlag(flags, "--endpoint") ?? env.SIGNALOPS_BASE_URL ?? "https://signalops.cc").replace(/\/$/, "");
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readEventInput(flags: Map<string, string | true>, env: CliEnv) {
  const inline = env.SIGNALOPS_VALIDATE_EVENTS_JSON;
  if (inline) {
    return inline;
  }

  const file = readFlag(flags, "--file");
  if (!file) {
    throw new Error("--file or SIGNALOPS_VALIDATE_EVENTS_JSON is required");
  }

  return file === "-" ? readStdin() : readFile(file, "utf8");
}

function payloadEventsFromJson(value: unknown): SignalOpsEvent | SignalOpsEvent[] {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "events" in value &&
    Array.isArray(value.events)
  ) {
    return value.events as SignalOpsEvent[];
  }

  return value as SignalOpsEvent;
}

function operatorHeaders(flags: Map<string, string | true>, env: CliEnv) {
  const token = readFlag(flags, "--operator-token") ?? env.SIGNALOPS_OPERATOR_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : undefined;
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON (${response.status}): ${text.slice(0, 220)}`);
  }

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function fetchText(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 220)}`);
  }

  return text;
}

async function sourceKit(flags: Map<string, string | true>, env: CliEnv) {
  return fetchJson(`${endpointFrom(flags, env)}/api/source-kit`);
}

async function sourceReport(flags: Map<string, string | true>, env: CliEnv) {
  const endpoint = endpointFrom(flags, env);
  const format = readFlag(flags, "--format") ?? "json";
  if (format !== "json" && format !== "markdown" && format !== "csv") {
    throw new Error("--format must be json, markdown, or csv");
  }

  const params = new URLSearchParams();
  const range = readFlag(flags, "--range");
  const eventId = readFlag(flags, "--event-id");
  const providerId = readFlag(flags, "--provider-id");
  const modelId = readFlag(flags, "--model-id");
  const limit = readFlag(flags, "--limit");
  if (range) {
    params.set("range", range);
  }
  if (eventId) {
    params.set("eventId", eventId);
  }
  if (providerId) {
    params.set("providerId", providerId);
  }
  if (modelId) {
    params.set("modelId", modelId);
  }
  if (limit) {
    params.set("limit", limit);
  }
  if (format !== "json") {
    params.set("format", format);
  }

  const query = params.toString();
  const url = `${endpoint}/api/source-report${query ? `?${query}` : ""}`;
  const init = { headers: operatorHeaders(flags, env) };
  return format === "json" ? fetchJson(url, init) : fetchText(url, init);
}

async function validateEvents(flags: Map<string, string | true>, env: CliEnv) {
  const raw = await readEventInput(flags, env);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Event payload must be valid JSON");
  }

  const signalops = createSignalOpsClient({ endpoint: endpointFrom(flags, env) });
  return signalops.validate(payloadEventsFromJson(parsed));
}

function createVerificationEvent(flags: Map<string, string | true>, env: CliEnv): SignalOpsEvent {
  const runId = Date.now().toString(36);
  const generationId = readFlag(flags, "--generation") ?? env.SIGNALOPS_VERIFY_GENERATION_ID ?? `gen_verify_${runId}`;
  return {
    type: "generation.completed",
    eventId: readFlag(flags, "--event-id") ?? env.SIGNALOPS_VERIFY_EVENT_ID ?? `generation.completed:${generationId}`,
    generationId,
    providerId: readFlag(flags, "--provider") ?? env.SIGNALOPS_VERIFY_PROVIDER ?? "verify-provider",
    modelId: readFlag(flags, "--model") ?? env.SIGNALOPS_VERIFY_MODEL ?? "verify-model",
    status: "succeeded",
    source: readFlag(flags, "--source") ?? env.SIGNALOPS_VERIFY_SOURCE ?? "verify-source",
    durationMs: 1420,
    cost: 0.012,
    retryCount: 0,
  };
}

async function verifySource(flags: Map<string, string | true>, env: CliEnv) {
  const endpoint = endpointFrom(flags, env);
  const token = readFlag(flags, "--token") ?? env.SIGNALOPS_INGEST_TOKEN;
  const allowStorageGate = flags.has("--allow-storage-gate");
  const event = createVerificationEvent(flags, env);
  const signalops = createSignalOpsClient({ endpoint, token, failOpen: false });
  const validation = await signalops.validate(event);

  if (!token) {
    return {
      ok: true,
      mode: "validation_only",
      endpoint,
      event,
      validation,
      next: "Set SIGNALOPS_INGEST_TOKEN or pass --token to test authenticated ingest.",
    };
  }

  try {
    const ingest = await signalops.ingest(event);
    return {
      ok: true,
      mode: "authenticated_ingest",
      endpoint,
      event,
      validation,
      ingest,
    };
  } catch (error) {
    if (
      allowStorageGate &&
      error instanceof SignalOpsHttpError &&
      error.status === 503 &&
      (error.code === "ingest_storage_not_configured" || error.code === "workspace_not_configured")
    ) {
      return {
        ok: true,
        mode: "storage_gate",
        endpoint,
        event,
        validation,
        ingest: {
          accepted: false,
          status: error.status,
          code: error.code,
          requestId: error.requestId ?? null,
        },
        next:
          error.code === "workspace_not_configured"
            ? "Set SIGNALOPS_WORKSPACE_SLUG to a real non-demo workspace slug before controlled pilot ingest."
            : "Durable storage is not connected yet; this is expected before D1/Supabase cutover.",
      };
    }

    throw error;
  }
}

export async function runSignalOpsCli(
  argv = process.argv.slice(2),
  env: CliEnv = process.env,
  io: CliIo = console,
): Promise<0 | 1> {
  try {
    const { command, flags } = parseArgs(argv);
    if (!command || flags.has("--help")) {
      io.log(usage());
      return command || flags.has("--help") ? 0 : 1;
    }

    const result =
      command === "source-kit"
        ? await sourceKit(flags, env)
        : command === "validate-events"
          ? await validateEvents(flags, env)
          : command === "verify-source"
            ? await verifySource(flags, env)
            : command === "source-report"
              ? await sourceReport(flags, env)
            : undefined;

    if (!result) {
      throw new Error(`Unknown command: ${command}`);
    }

    io.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runSignalOpsCli();
}
