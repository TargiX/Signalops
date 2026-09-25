import { hasConfiguredSecret } from "./runtime-config.ts";

type RuntimeEnv = Record<string, string | undefined>;

export function isCockpitPasswordAuthConfiguredFromEnv(env: RuntimeEnv = process.env) {
  return env.SIGNALOPS_REQUIRE_AUTH === "true" && hasConfiguredSecret(env.SIGNALOPS_COCKPIT_PASSWORD);
}

function secretDiffersFrom(value: string | undefined, ...others: Array<string | undefined>) {
  return hasConfiguredSecret(value) && others.every((other) => !hasConfiguredSecret(other) || other !== value);
}

export function isCockpitAuthRequiredFromEnv(env: RuntimeEnv = process.env) {
  return isCockpitPasswordAuthConfiguredFromEnv(env);
}

export function isCockpitSessionSecretConfiguredFromEnv(env: RuntimeEnv = process.env) {
  return hasConfiguredSecret(env.SIGNALOPS_SESSION_SECRET);
}

export function isCockpitPasswordAuthPilotReadyFromEnv(env: RuntimeEnv = process.env) {
  return (
    isCockpitPasswordAuthConfiguredFromEnv(env) &&
    isCockpitSessionSecretConfiguredFromEnv(env) &&
    secretDiffersFrom(env.SIGNALOPS_COCKPIT_PASSWORD, env.SIGNALOPS_INGEST_TOKEN, env.SIGNALOPS_OPERATOR_TOKEN) &&
    secretDiffersFrom(env.SIGNALOPS_SESSION_SECRET, env.SIGNALOPS_COCKPIT_PASSWORD, env.SIGNALOPS_INGEST_TOKEN)
  );
}

export function isOperatorApiTokenConfiguredFromEnv(env: RuntimeEnv = process.env) {
  return secretDiffersFrom(env.SIGNALOPS_OPERATOR_TOKEN, env.SIGNALOPS_INGEST_TOKEN, env.SIGNALOPS_COCKPIT_PASSWORD);
}

export function isOperatorAccessConfiguredFromEnv(env: RuntimeEnv = process.env) {
  return isCockpitAuthRequiredFromEnv(env) || isOperatorApiTokenConfiguredFromEnv(env);
}

export function isOperatorAccessPilotReadyFromEnv(env: RuntimeEnv = process.env) {
  return isCockpitPasswordAuthPilotReadyFromEnv(env) || isOperatorApiTokenConfiguredFromEnv(env);
}
