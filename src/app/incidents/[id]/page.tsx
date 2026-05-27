import { IncidentDetail } from "@/components/incident-detail";
import { getOpsSnapshot } from "@/lib/mock-data";

export function generateStaticParams() {
  return getOpsSnapshot("24h").incidents.map((incident) => ({
    id: incident.id,
  }));
}

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <IncidentDetail incidentId={id} />;
}
