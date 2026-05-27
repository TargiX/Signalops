"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Generation,
  GenerationStatus,
  Model,
  Provider,
  ProviderId,
} from "@/lib/mock-data";
import { cn, formatCurrency, formatMs } from "@/lib/utils";

const statusStyle: Record<Generation["status"], string> = {
  succeeded: "bg-[var(--success-soft)] text-[var(--success)]",
  failed: "bg-[var(--danger-soft)] text-[var(--danger)]",
  running: "bg-[var(--info-soft)] text-[var(--info)]",
  queued: "bg-[var(--surface-mute)] text-[var(--text-dim)]",
  retrying: "bg-[var(--warning-soft)] text-[var(--warning)]",
  blocked: "bg-[var(--danger-soft)] text-[var(--danger)]",
};

const tableGrid =
  "grid-cols-[92px_minmax(260px,1.55fr)_minmax(180px,0.9fr)_120px_124px_108px_92px_86px]";

export function GenerationTable({
  rows,
  providers,
  models,
  focusProviderId = "all",
  focusStatus = "all",
  selectedRowId,
  onRowSelect,
  subtitle = "10,000 synthetic jobs with headless table state and virtualized rendering.",
}: {
  rows: Generation[];
  providers: Provider[];
  models: Model[];
  focusProviderId?: ProviderId | "all";
  focusStatus?: GenerationStatus | "all";
  selectedRowId?: string;
  onRowSelect?: (row: Generation) => void;
  subtitle?: string;
}) {
  "use no memo";

  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setProviderFilter(focusProviderId);
  }, [focusProviderId]);

  useEffect(() => {
    setStatusFilter(focusStatus);
  }, [focusStatus]);

  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models],
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const matchesProvider =
          providerFilter === "all" || row.providerId === providerFilter;
        const matchesStatus =
          statusFilter === "all" || row.status === statusFilter;

        return matchesProvider && matchesStatus;
      }),
    [providerFilter, rows, statusFilter],
  );

  const columns = useMemo<ColumnDef<Generation>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "Time",
        cell: ({ row }) =>
          <span className="font-mono text-[13px]">
            {new Intl.DateTimeFormat("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(row.original.createdAt))}
          </span>,
      },
      {
        accessorKey: "prompt",
        header: "Prompt",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="max-w-[360px] truncate text-[var(--text)]">
              {row.original.prompt}
            </div>
            <div className="mt-1 truncate text-xs text-[var(--mute)]">
              {row.original.user}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "modelId",
        header: "Model",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-[var(--text)]">
              {modelById.get(row.original.modelId)?.name ?? row.original.modelId}
            </div>
            <div className="text-xs text-[var(--mute)]">
              {providerById.get(row.original.providerId)?.name}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "source",
        header: "Source",
        cell: ({ row }) => (
          <span className="rounded-md border border-[var(--border)] bg-[var(--surface-mute)] px-2 py-1 text-xs text-[var(--text-dim)]">
            {row.original.source}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <span
            className={cn(
              "inline-flex min-w-20 justify-center rounded-full px-2 py-1 text-xs font-medium",
              statusStyle[row.original.status],
            )}
          >
            {row.original.status}
          </span>
        ),
      },
      {
        accessorKey: "durationMs",
        header: "Latency",
        cell: ({ row }) => (
          <span className="font-mono text-[13px]">
            {formatMs(row.original.durationMs)}
          </span>
        ),
      },
      {
        accessorKey: "cost",
        header: "Cost",
        cell: ({ row }) => (
          <span className="font-mono text-[13px]">
            {formatCurrency(row.original.cost)}
          </span>
        ),
      },
      {
        accessorKey: "retryCount",
        header: "Retries",
        cell: ({ row }) => (
          <span className="font-mono text-[13px]">{row.original.retryCount}</span>
        ),
      },
    ],
    [modelById, providerById],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table intentionally returns table helpers; React Compiler safely skips this call site.
  const table = useReactTable({
    data: filteredRows,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const tableRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-1)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--border)] p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-[var(--text)]">Generation Queue</h2>
          <p className="mt-1 text-sm text-[var(--text-dim)]">
            {subtitle}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text-dim)] shadow-[var(--shadow-1)]">
            <Search className="size-4 text-[var(--mute)]" />
            <input
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder="Search prompts, users, models"
              className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-[var(--mute)] sm:min-w-56"
            />
          </label>
          <select
            value={providerFilter}
            onChange={(event) => setProviderFilter(event.target.value)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] shadow-[var(--shadow-1)] outline-none"
          >
            <option value="all">All providers</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] shadow-[var(--shadow-1)] outline-none"
          >
            <option value="all">All states</option>
            {Object.keys(statusStyle).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1080px] text-left text-sm" role="table">
          <div role="rowgroup">
            {table.getHeaderGroups().map((headerGroup) => (
              <div
                key={headerGroup.id}
                className={cn(
                  "grid border-b border-[var(--border)] bg-[var(--surface-mute)] text-[11px] uppercase text-[var(--mute)]",
                  tableGrid,
                )}
                role="row"
              >
                {headerGroup.headers.map((header) => (
                  <div
                    key={header.id}
                    className="flex h-10 items-center px-4 font-semibold"
                    role="columnheader"
                  >
                    <button
                      onClick={header.column.getToggleSortingHandler()}
                      className="inline-flex items-center gap-2"
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <ArrowUpDown className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div
            ref={scrollRef}
            className="max-h-[640px] overflow-auto"
            data-virtualized-rows={tableRows.length}
          >
            <div
              className="relative"
              role="rowgroup"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {virtualRows.map((virtualRow) => {
                const row = tableRows[virtualRow.index];

                return (
                  <div
                    key={row.id}
                    onClick={() => onRowSelect?.(row.original)}
                    className={cn(
                      "absolute left-0 grid w-full border-t border-[var(--border-soft)] text-[var(--text-dim)] transition-colors",
                      onRowSelect && "cursor-pointer hover:bg-[var(--surface-mute)]",
                      selectedRowId === row.original.id &&
                        "bg-[var(--accent-soft)] text-[var(--text)]",
                      tableGrid,
                    )}
                    role="row"
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        className="flex h-14 items-center px-4"
                        role="cell"
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--surface-mute)] px-4 py-2 text-xs text-[var(--mute)]"
            role="caption"
          >
            <span>TanStack Table state + TanStack Virtual rows</span>
            <span className="font-mono">
              {virtualRows.length}/{tableRows.length} mounted
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
