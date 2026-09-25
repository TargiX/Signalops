import { Dashboard } from "@/components/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CockpitPage() {
  return <Dashboard />;
}
