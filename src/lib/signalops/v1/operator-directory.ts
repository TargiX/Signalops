import {
  getSignalOpsSupabaseConfigV1,
  signalOpsSupabaseRestRequestV1,
} from "./supabase.ts";

export type SignalOpsOperatorRoleV1 = "owner" | "operator" | "viewer";

export type SignalOpsOperatorMembershipV1 = {
  tenantId: string;
  tenantName: string;
  role: SignalOpsOperatorRoleV1;
};

type MembershipRow = {
  tenant_id: string;
  role: SignalOpsOperatorRoleV1;
};

type TenantRow = {
  id: string;
  name: string;
  status: "active" | "suspended" | "closed";
};

export type SignalOpsTenantSummaryV1 = Pick<SignalOpsOperatorMembershipV1, "tenantId" | "tenantName">;

function inFilter(values: readonly string[]): string {
  return `in.(${values.map((value) => `"${value.replaceAll('"', '\\"')}"`).join(",")})`;
}

export async function listSignalOpsOperatorMembershipsV1(
  subject: string,
): Promise<SignalOpsOperatorMembershipV1[]> {
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) return [];

  const membershipFilters = new URLSearchParams({
    select: "tenant_id,role",
    subject: `eq.${subject}`,
  });
  const memberships = await signalOpsSupabaseRestRequestV1<MembershipRow[]>(
    config,
    `signalops_v1_operator_memberships?${membershipFilters}`,
  );
  if (memberships.length === 0) return [];

  const tenantIds = [...new Set(memberships.map((membership) => membership.tenant_id))];
  const tenantFilters = new URLSearchParams({
    select: "id,name,status",
    id: inFilter(tenantIds),
  });
  const tenants = await signalOpsSupabaseRestRequestV1<TenantRow[]>(
    config,
    `signalops_v1_tenants?${tenantFilters}`,
  );
  const tenantById = new Map(
    tenants.filter((tenant) => tenant.status === "active").map((tenant) => [tenant.id, tenant]),
  );

  return memberships
    .flatMap((membership) => {
      const tenant = tenantById.get(membership.tenant_id);
      return tenant
        ? [{ tenantId: tenant.id, tenantName: tenant.name, role: membership.role }]
        : [];
    })
    .sort((left, right) => left.tenantName.localeCompare(right.tenantName));
}

export async function resolveSignalOpsOperatorMembershipV1(input: {
  subject: string;
  tenantId: string;
}): Promise<SignalOpsOperatorMembershipV1 | null> {
  const memberships = await listSignalOpsOperatorMembershipsV1(input.subject);
  return memberships.find((membership) => membership.tenantId === input.tenantId) ?? null;
}

export async function listActiveSignalOpsTenantsV1(): Promise<SignalOpsTenantSummaryV1[]> {
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) return [];
  const filters = new URLSearchParams({
    select: "id,name,status",
    status: "eq.active",
    order: "id.asc",
    limit: "500",
  });
  const tenants = await signalOpsSupabaseRestRequestV1<TenantRow[]>(
    config,
    `signalops_v1_tenants?${filters}`,
  );
  return tenants.map((tenant) => ({ tenantId: tenant.id, tenantName: tenant.name }));
}
