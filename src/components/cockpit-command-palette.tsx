"use client";

import { Dialog } from "@base-ui/react/dialog";
import {
  Bookmark,
  Command,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, useState } from "react";

import type { SignalOpsSavedCockpitViewV1 } from "@/lib/signalops/v1/cockpit-view";

export type SignalOpsCockpitCommand = {
  id: string;
  label: string;
  description: string;
  keywords?: readonly string[];
  icon: LucideIcon;
  run: () => void;
};

export function CockpitCommandPalette({
  open,
  onOpenChange,
  commands,
  savedViews,
  onSaveView,
  onApplySavedView,
  onDeleteSavedView,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly SignalOpsCockpitCommand[];
  savedViews: readonly SignalOpsSavedCockpitViewV1[];
  onSaveView: (name: string) => boolean;
  onApplySavedView: (view: SignalOpsSavedCockpitViewV1) => void;
  onDeleteSavedView: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [viewName, setViewName] = useState("");
  const [saveError, setSaveError] = useState("");

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleCommands = commands.filter((command) =>
    !normalizedQuery ||
    [command.label, command.description, ...(command.keywords ?? [])]
      .join("\n")
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
  const visibleSavedViews = savedViews.filter((view) =>
    !normalizedQuery || view.name.toLocaleLowerCase().includes(normalizedQuery),
  );

  function runCommand(command: SignalOpsCockpitCommand) {
    changeOpen(false);
    command.run();
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) {
      setQuery("");
      setSaveError("");
    }
    onOpenChange(nextOpen);
  }

  function saveView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = viewName.trim();
    if (!name) {
      setSaveError("Enter a short name for this analysis view.");
      return;
    }
    if (!onSaveView(name)) {
      setSaveError("This view could not be saved. Use 60 characters or fewer.");
      return;
    }
    setViewName("");
    setSaveError("");
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[90] bg-slate-950/30 backdrop-blur-[2px] transition-opacity" />
        <Dialog.Viewport className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto px-4 py-[8vh] sm:py-[12vh]">
          <Dialog.Popup className="w-full max-w-[640px] overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[0_24px_80px_rgba(24,39,75,0.28)] outline-none">
            <header className="border-b border-[var(--border)] px-4 pt-4 sm:px-5 sm:pt-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Dialog.Title className="flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
                    <Command className="size-4 text-[var(--accent)]" /> Command cockpit
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-[10px] text-[var(--text-dim)]">
                    Navigate, investigate, export, or reopen a privacy-safe saved view
                  </Dialog.Description>
                </div>
                <Dialog.Close className="grid size-8 place-items-center rounded-lg text-[var(--mute)] transition hover:bg-[var(--surface-mute)] hover:text-[var(--text)]" aria-label="Close command cockpit">
                  <X className="size-4" />
                </Dialog.Close>
              </div>
              <label className="relative mt-4 block pb-4">
                <span className="sr-only">Search cockpit commands and saved views</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-[calc(50%+0.5rem)] text-[var(--mute)]" />
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && visibleCommands[0]) {
                      event.preventDefault();
                      runCommand(visibleCommands[0]);
                    }
                  }}
                  placeholder="Search commands, sections, filters…"
                  className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-mute)] pl-10 pr-16 text-sm text-[var(--text-strong)] shadow-inner placeholder:text-[var(--mute)]"
                />
                <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-[calc(50%+0.5rem)] rounded-md border border-[var(--border)] bg-white px-1.5 py-1 font-mono text-[9px] font-bold text-[var(--mute)]">Esc</kbd>
              </label>
            </header>

            <div className="max-h-[52vh] overflow-y-auto px-2 py-2 sm:px-3">
              <p className="px-2 pb-2 pt-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--mute)]">Actions</p>
              <div className="grid gap-1">
                {visibleCommands.map((command) => {
                  const Icon = command.icon;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      onClick={() => runCommand(command)}
                      className="group flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] transition group-hover:border-blue-200 group-hover:text-[var(--accent)]"><Icon className="size-4" /></span>
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-[var(--text-strong)]">{command.label}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-[var(--text-dim)]">{command.description}</span>
                      </span>
                    </button>
                  );
                })}
                {visibleCommands.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-7 text-center text-xs text-[var(--text-dim)]">No command matches this search.</p>
                ) : null}
              </div>

              {(visibleSavedViews.length > 0 || !normalizedQuery) ? (
                <section className="mt-3 border-t border-[var(--border-soft)] pt-3">
                  <div className="flex items-center justify-between gap-3 px-2 pb-2">
                    <p className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--mute)]">Saved views</p>
                    <span className="font-mono text-[9px] text-[var(--mute)]">{savedViews.length} / 12</span>
                  </div>
                  <div className="grid gap-1">
                    {visibleSavedViews.map((view) => (
                      <div key={view.id} className="group flex items-center gap-2 rounded-xl px-2 py-1 transition hover:bg-[var(--surface-mute)]">
                        <button
                          type="button"
                          onClick={() => {
                            changeOpen(false);
                            onApplySavedView(view);
                          }}
                          className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        >
                          <Bookmark className="size-4 shrink-0 text-[var(--accent)]" />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-[var(--text-strong)]">{view.name}</span>
                            <span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--mute)]">{view.view.range} · {view.view.status}{view.view.model ? ` · ${view.view.model}` : ""}</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteSavedView(view.id)}
                          className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--mute)] transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                          aria-label={`Delete saved view ${view.name}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                    {visibleSavedViews.length === 0 && !normalizedQuery ? (
                      <p className="px-3 py-2 text-[10px] leading-4 text-[var(--text-dim)]">Save a focused view to reopen the same safe filters without rebuilding the investigation.</p>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>

            <form onSubmit={saveView} className="border-t border-[var(--border)] bg-[var(--surface-mute)] px-4 py-3 sm:px-5">
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Saved view name</span>
                  <input
                    value={viewName}
                    onChange={(event) => {
                      setViewName(event.target.value);
                      setSaveError("");
                    }}
                    maxLength={60}
                    placeholder="Name the current safe view"
                    className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-xs text-[var(--text-strong)] shadow-sm placeholder:text-[var(--mute)]"
                    aria-invalid={Boolean(saveError)}
                    aria-describedby={saveError ? "saved-view-error" : undefined}
                  />
                </label>
                <button type="submit" disabled={savedViews.length >= 12} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-xs font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-45">
                  <Bookmark className="size-3.5" /> Save current view
                </button>
              </div>
              {saveError ? <p id="saved-view-error" role="alert" className="mt-2 text-[10px] font-medium text-rose-700">{saveError}</p> : null}
              <p className="mt-2 text-[9px] text-[var(--mute)]">Free-form search and operation IDs are never persisted.</p>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
