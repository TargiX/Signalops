import path from "node:path";

import { createFileSignalOpsEventStoreV1 } from "./file-event-store.ts";
import type { SignalOpsEventReaderV1, SignalOpsEventStoreV1 } from "./event-store.ts";
import {
  createSupabaseSignalOpsEventStoreV1,
  getSignalOpsSupabaseConfigV1,
} from "./supabase.ts";

export type SignalOpsRuntimeStoreV1 = SignalOpsEventStoreV1 & SignalOpsEventReaderV1;

const globalStore = globalThis as typeof globalThis & {
  __signalOpsRuntimeStoreV1?: SignalOpsRuntimeStoreV1;
};

export function signalOpsStorageModeV1(): "supabase" | "local_file" | "unavailable" {
  if (getSignalOpsSupabaseConfigV1()) return "supabase";
  if (process.env.NODE_ENV !== "production" || process.env.SIGNALOPS_ALLOW_LOCAL_STORE === "true") {
    return "local_file";
  }
  return "unavailable";
}

export function getSignalOpsRuntimeStoreV1(): SignalOpsRuntimeStoreV1 {
  if (globalStore.__signalOpsRuntimeStoreV1) return globalStore.__signalOpsRuntimeStoreV1;
  const supabase = getSignalOpsSupabaseConfigV1();
  if (supabase) {
    globalStore.__signalOpsRuntimeStoreV1 = createSupabaseSignalOpsEventStoreV1(supabase);
    return globalStore.__signalOpsRuntimeStoreV1;
  }
  if (signalOpsStorageModeV1() === "unavailable") {
    throw new Error("SignalOps durable storage is not configured");
  }
  globalStore.__signalOpsRuntimeStoreV1 = createFileSignalOpsEventStoreV1({
    filePath:
      process.env.SIGNALOPS_LOCAL_STORE_PATH?.trim() ||
      path.join(process.cwd(), ".data", "signalops-v1-events.jsonl"),
  });
  return globalStore.__signalOpsRuntimeStoreV1;
}
