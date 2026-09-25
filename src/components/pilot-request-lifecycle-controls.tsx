"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Save } from "lucide-react";

import type { PilotRequest, PilotRequestStatus } from "@/lib/signalops/pilot-requests";

const statuses: Array<{ value: PilotRequestStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "pilot_scoped", label: "Pilot scoped" },
  { value: "closed", label: "Closed" },
];

function toDateTimeLocal(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function PilotRequestLifecycleControls({ request }: { request: PilotRequest }) {
  const router = useRouter();
  const [status, setStatus] = useState<PilotRequestStatus>(request.lifecycle?.status ?? "new");
  const [operatorNote, setOperatorNote] = useState(request.lifecycle?.operatorNote ?? "");
  const [nextActionAt, setNextActionAt] = useState(toDateTimeLocal(request.lifecycle?.nextActionAt));
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function save() {
    setMessage("");
    startTransition(async () => {
      const response = await fetch("/api/pilot-requests", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: request.id,
          status,
          operatorNote: operatorNote.trim(),
          nextActionAt: nextActionAt || null,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !result.ok) {
        setMessage(result.error || `Update failed with ${response.status}`);
        return;
      }

      setMessage("Saved");
      router.refresh();
    });
  }

  return (
    <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(140px,180px)_minmax(180px,220px)_1fr_auto]">
        <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--mute)]">
          Status
          <select
            className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold normal-case text-[var(--text-strong)]"
            value={status}
            onChange={(event) => setStatus(event.target.value as PilotRequestStatus)}
          >
            {statuses.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--mute)]">
          Next action
          <input
            className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold normal-case text-[var(--text-strong)]"
            type="datetime-local"
            value={nextActionAt}
            onChange={(event) => setNextActionAt(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--mute)]">
          Operator note
          <textarea
            className="min-h-10 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium normal-case text-[var(--text-strong)]"
            value={operatorNote}
            onChange={(event) => setOperatorNote(event.target.value)}
          />
        </label>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={isPending}
          type="button"
          onClick={save}
        >
          <Save className="size-4" />
          {isPending ? "Saving" : "Save"}
        </button>
      </div>
      {message ? (
        <p className="mt-3 text-xs font-semibold text-[var(--text-dim)]" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
