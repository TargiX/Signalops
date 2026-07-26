import type { Incident, Model, Provider } from "@/lib/mock-data";

export type SpendGuardFinding = {
  providerId: Provider["id"];
  providerName: string;
  providerStatus: Provider["status"];
  highestCostModel: string | null;
  costPerSuccessfulGeneration: number;
  recoverableSpend: number;
  failureRate: number;
  incidentId: string | null;
};

export function buildSpendGuard({
  providers,
  models,
  incidents,
}: {
  providers: Provider[];
  models: Model[];
  incidents: Incident[];
}): SpendGuardFinding[] {
  return providers
    .filter((provider) => provider.volume > 0)
    .map((provider) => {
      const successfulGenerations = provider.volume * (1 - provider.failureRate / 100);
      const highestCostModel = models
        .filter((model) => model.providerId === provider.id)
        .sort((left, right) => right.costPerImage - left.costPerImage)[0];
      const incident = incidents.find(
        (item) => item.providerId === provider.id,
      );

      return {
        providerId: provider.id,
        providerName: provider.name,
        providerStatus: provider.status,
        highestCostModel: highestCostModel?.name ?? null,
        costPerSuccessfulGeneration: provider.spend / successfulGenerations,
        recoverableSpend: provider.spend * (provider.failureRate / 100),
        failureRate: provider.failureRate,
        incidentId: incident?.id ?? null,
      };
    })
    .sort(
      (left, right) =>
        right.recoverableSpend - left.recoverableSpend ||
        right.costPerSuccessfulGeneration - left.costPerSuccessfulGeneration,
    );
}
