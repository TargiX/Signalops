import type { Metadata } from "next";

import { WorkspaceSettings } from "@/components/workspace-settings";

export const metadata: Metadata = {
  title: "Workspace settings · SignalOps",
  description: "Manage privacy-safe, revocable SignalOps ingest credentials.",
};

export default function SettingsPage() {
  return <WorkspaceSettings />;
}
