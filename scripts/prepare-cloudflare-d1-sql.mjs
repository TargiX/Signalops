#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const sql = `CREATE TABLE IF NOT EXISTS signalops_events (
  event_id TEXT NOT NULL,
  workspace_slug TEXT NOT NULL,
  type TEXT NOT NULL,
  generation_id TEXT,
  provider_id TEXT,
  model_id TEXT,
  status TEXT,
  source TEXT,
  duration_ms INTEGER,
  cost REAL,
  retry_count INTEGER,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (workspace_slug, event_id)
);

CREATE INDEX IF NOT EXISTS signalops_events_workspace_occurred_at_idx
  ON signalops_events (workspace_slug, occurred_at DESC);

CREATE INDEX IF NOT EXISTS signalops_events_workspace_provider_idx
  ON signalops_events (workspace_slug, provider_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS signalops_events_workspace_model_idx
  ON signalops_events (workspace_slug, model_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS signalops_events_workspace_provider_model_idx
  ON signalops_events (workspace_slug, provider_id, model_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS signalops_pilot_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  product_url TEXT,
  generation_volume TEXT,
  providers TEXT,
  primary_pain TEXT,
  urgency TEXT,
  desired_outcome TEXT,
  qualification_tier TEXT NOT NULL DEFAULT 'evaluate',
  qualification_signals TEXT NOT NULL DEFAULT '[]',
  lifecycle_status TEXT NOT NULL DEFAULT 'new',
  operator_note TEXT,
  next_action_at TEXT,
  updated_at TEXT,
  use_case TEXT NOT NULL,
  source TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS signalops_pilot_requests_created_at_idx
  ON signalops_pilot_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS signalops_pilot_requests_qualification_idx
  ON signalops_pilot_requests (qualification_tier, created_at DESC);

CREATE INDEX IF NOT EXISTS signalops_pilot_requests_lifecycle_idx
  ON signalops_pilot_requests (lifecycle_status, next_action_at, created_at DESC);

CREATE TABLE IF NOT EXISTS signalops_pilot_request_activity (
  id TEXT PRIMARY KEY,
  pilot_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS signalops_pilot_request_activity_request_idx
  ON signalops_pilot_request_activity (pilot_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS signalops_pilot_request_activity_created_at_idx
  ON signalops_pilot_request_activity (created_at DESC);
`;

const writeIndex = process.argv.indexOf("--write");
const writePath = writeIndex >= 0 ? process.argv[writeIndex + 1] : "";

if (writePath) {
  mkdirSync(dirname(writePath), { recursive: true });
  writeFileSync(writePath, sql);
  console.log(`Wrote ${writePath}`);
} else {
  process.stdout.write(sql);
}
