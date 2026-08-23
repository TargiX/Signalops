import {
  configuredSignalOpsTenantV1,
  isSignalOpsOperatorAuthConfiguredV1,
  readSignalOpsOperatorSessionV1,
  type SignalOpsOperatorSessionV1,
} from "./session.ts";
import {
  listSignalOpsOperatorMembershipsV1,
  resolveSignalOpsOperatorMembershipV1,
  type SignalOpsOperatorMembershipV1,
} from "./operator-directory.ts";
import {
  getSignalOpsSupabaseUserV1,
  isSignalOpsSupabaseAuthConfiguredV1,
} from "./supabase-auth.ts";

export async function authorizeSignalOpsOperatorSessionV1(
  request: Request,
): Promise<SignalOpsOperatorSessionV1 | null> {
  const session = readSignalOpsOperatorSessionV1(request);
  if (!session) return null;
  if (session.authMode === "password") {
    return isSignalOpsOperatorAuthConfiguredV1() ? session : null;
  }
  if (!isSignalOpsSupabaseAuthConfiguredV1()) return null;

  const user = await getSignalOpsSupabaseUserV1();
  if (!user || user.id !== session.subject) return null;
  const membership = await resolveSignalOpsOperatorMembershipV1({
    subject: user.id,
    tenantId: session.tenantId,
  });
  if (!membership) return null;
  return {
    ...session,
    tenantName: membership.tenantName,
    role: membership.role,
  };
}

export async function listAuthorizedSignalOpsMembershipsV1(
  session: SignalOpsOperatorSessionV1,
): Promise<SignalOpsOperatorMembershipV1[]> {
  if (session.authMode === "password") {
    const tenant = configuredSignalOpsTenantV1();
    return [{ tenantId: tenant.id, tenantName: tenant.name, role: "owner" }];
  }
  return listSignalOpsOperatorMembershipsV1(session.subject);
}
