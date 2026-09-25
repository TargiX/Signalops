export function isPlaceholderValue(value: string | undefined | null) {
  return (
    !value ||
    /your[_-]?(account|database|project|token|key|password|secret)|example\.com|^\.{3}$|placeholder/i.test(value)
  );
}

export function isConfiguredHttpUrl(value: string | undefined | null) {
  if (isPlaceholderValue(value)) {
    return false;
  }

  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isConfiguredDeliveryUrl(
  value: string | undefined | null,
  env: Record<string, string | undefined> = process.env,
) {
  if (isPlaceholderValue(value)) {
    return false;
  }

  try {
    const url = new URL(value ?? "");
    const productionRuntime = isProductionRuntime(env);
    return productionRuntime ? url.protocol === "https:" : url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isConfiguredPublicBaseUrl(value: string | undefined | null) {
  if (isPlaceholderValue(value)) {
    return false;
  }

  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isProductionRuntime(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV === "production" || Boolean(env.VERCEL);
}

export function hasConfiguredSecret(value: string | undefined | null) {
  return Boolean(value && !isPlaceholderValue(value));
}

export function firstConfiguredSecret(...values: Array<string | undefined | null>) {
  return values.find((value): value is string => hasConfiguredSecret(value));
}

export function missingConfiguredEnv(names: string[]) {
  return names.filter((name) => isPlaceholderValue(process.env[name]));
}
