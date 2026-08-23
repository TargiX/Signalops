import type { SignalOpsPrincipalScopeV1, SignalOpsTenantPrincipalV1 } from "./types.ts";

const opaqueIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export function assertSignalOpsTenantPrincipalV1(
  principal: SignalOpsTenantPrincipalV1,
  requiredScope: SignalOpsPrincipalScopeV1,
): void {
  if (!principal || typeof principal !== "object") {
    throw new Error("an authenticated tenant principal is required");
  }

  if (!opaqueIdentifierPattern.test(principal.tenantId)) {
    throw new Error("principal tenantId must be a bounded opaque identifier");
  }

  if (!opaqueIdentifierPattern.test(principal.credentialId)) {
    throw new Error("principal credentialId must be a bounded opaque identifier");
  }

  if (!Array.isArray(principal.scopes) || !principal.scopes.includes(requiredScope)) {
    throw new Error(`principal requires ${requiredScope} scope`);
  }
}
