import { Dashboard } from "@/components/dashboard";
import { LiveCockpit } from "@/components/live-cockpit";

export default async function CockpitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return params.mode === "demo" ? <Dashboard /> : <LiveCockpit />;
}
