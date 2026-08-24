import type { Metadata } from "next";

import { OnboardingFlow } from "@/components/onboarding-flow";

export const metadata: Metadata = {
  title: "Start with SignalOps",
  description: "Create a workspace, issue a revocable ingest credential, and send your first privacy-safe AI operation signal.",
};

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
