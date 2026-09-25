export function buildOpenApiSpec() {
  const defaultMaxBatchEvents = 100;
  const defaultMaxBodyBytes = 256 * 1024;

  return {
    openapi: "3.1.0",
    info: {
      title: "SignalOps API",
      version: "0.1.0",
      summary: "Hosted-demo and controlled-pilot APIs for AI generation operations.",
      description:
        "SignalOps exposes public event validation, token-protected event ingest, pilot request intake, and operator readiness contracts. Hosted deployments remain fail-closed until durable storage and delivery env are configured.",
    },
    servers: [{ url: "https://signalops.cc" }],
    tags: [
      { name: "Public" },
      { name: "Source Events" },
      { name: "Pilot Intake" },
      { name: "Operator" },
    ],
    paths: {
      "/api/status": {
        get: {
          tags: ["Public"],
          summary: "Public product stage and claim boundary.",
          responses: {
            "200": {
              description: "Current launch classification.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StatusResponse" },
                },
              },
            },
          },
        },
      },
      "/api/health": {
        get: {
          tags: ["Operator"],
          summary: "Operator-facing readiness without secret values.",
          responses: {
            "200": {
              description: "Readiness gates for storage, validation, ingest, and pilot intake.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthResponse" },
                },
              },
            },
          },
        },
      },
      "/api/setup-plan": {
        get: {
          tags: ["Operator"],
          summary: "Machine-readable production cutover plan.",
          responses: {
            "200": {
              description: "Setup gates and blocked external steps.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SetupPlanResponse" },
                },
              },
            },
          },
        },
      },
      "/api/source-kit": {
        get: {
          tags: ["Source Events"],
          summary: "Machine-readable source-app integration kit.",
          responses: {
            "200": {
              description: "Endpoints, required env names, ingest policy, and copyable integration snippets.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SourceKitResponse" },
                },
              },
            },
          },
        },
      },
      "/api/events/validate": {
        post: {
          tags: ["Source Events"],
          summary: "Validate source events without storing payloads.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/SignalEventInput" },
                    { $ref: "#/components/schemas/SignalEventBatchInput" },
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Dry-run validation summary. This endpoint never stores events.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EventValidationResponse" },
                },
              },
            },
            "400": { $ref: "#/components/responses/InvalidJson" },
            "413": { $ref: "#/components/responses/PayloadTooLarge" },
            "415": { $ref: "#/components/responses/UnsupportedMediaType" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/api/events": {
        post: {
          tags: ["Source Events"],
          summary: "Store source events after durable storage and token setup.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/SignalEventInput" },
                    { $ref: "#/components/schemas/SignalEventBatchInput" },
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Ingest result with idempotency counters.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EventIngestResponse" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "413": { $ref: "#/components/responses/PayloadTooLarge" },
            "415": { $ref: "#/components/responses/UnsupportedMediaType" },
            "422": { $ref: "#/components/responses/InvalidEvent" },
            "429": { $ref: "#/components/responses/RateLimited" },
            "503": { $ref: "#/components/responses/IngestStorageNotConfigured" },
          },
        },
      },
      "/api/source-report": {
        get: {
          tags: ["Source Events"],
          summary: "Source-only operational report from stored events.",
          security: [{ cookieAuth: [] }, { bearerAuth: [] }],
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 1000, default: 500 },
            },
            {
              name: "range",
              in: "query",
              schema: { type: "string", enum: ["all", "24h", "7d", "30d"], default: "all" },
            },
            {
              name: "eventId",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "providerId",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "modelId",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "format",
              in: "query",
              schema: { type: "string", enum: ["markdown", "csv"] },
              description: "Return the source-only report as Markdown or CSV instead of JSON.",
            },
          ],
          responses: {
            "200": {
              description: "Operational report built only from stored source events.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SourceReportResponse" },
                },
                "text/markdown": {
                  schema: { type: "string" },
                },
                "text/csv": {
                  schema: { type: "string" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/pilot-requests": {
        get: {
          tags: ["Operator"],
          summary: "List captured pilot requests for operator follow-up.",
          security: [{ cookieAuth: [] }, { bearerAuth: [] }],
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            },
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["new", "contacted", "pilot_scoped", "closed"] },
            },
            {
              name: "tier",
              in: "query",
              schema: { type: "string", enum: ["evaluate", "strong_fit", "urgent_fit"] },
            },
            {
              name: "followUp",
              in: "query",
              schema: { type: "string", enum: ["all", "open", "due", "unscheduled"] },
            },
            {
              name: "format",
              in: "query",
              schema: { type: "string", enum: ["csv"] },
              description: "Return filtered pilot requests as a CSV export instead of JSON.",
            },
          ],
          responses: {
            "200": {
              description: "Captured pilot requests ordered by qualification priority.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PilotRequestListResponse" },
                },
                "text/csv": {
                  schema: { type: "string" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "503": { $ref: "#/components/responses/OperatorAuthNotConfigured" },
          },
        },
        post: {
          tags: ["Pilot Intake"],
          summary: "Submit public pilot interest when storage or delivery is configured.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PilotRequestInput" },
              },
            },
          },
          responses: {
            "202": {
              description: "Pilot request accepted and delivered to at least one configured target.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PilotRequestAcceptedResponse" },
                },
              },
            },
            "413": { $ref: "#/components/responses/PayloadTooLarge" },
            "422": { $ref: "#/components/responses/InvalidPilotRequest" },
            "415": { $ref: "#/components/responses/UnsupportedMediaType" },
            "429": { $ref: "#/components/responses/RateLimited" },
            "424": { $ref: "#/components/responses/PilotDeliveryFailed" },
            "503": { $ref: "#/components/responses/PilotIntakeNotConfigured" },
          },
        },
        patch: {
          tags: ["Operator"],
          summary: "Update operator lifecycle fields for a captured pilot request.",
          security: [{ cookieAuth: [] }, { bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PilotRequestLifecycleUpdateInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Pilot request lifecycle updated.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PilotRequestLifecycleUpdateResponse" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "415": { $ref: "#/components/responses/UnsupportedMediaType" },
            "422": { $ref: "#/components/responses/InvalidPilotRequestLifecycleUpdate" },
            "503": { $ref: "#/components/responses/OperatorAuthNotConfigured" },
          },
        },
      },
      "/api/pilot-requests/{id}/handoff": {
        get: {
          tags: ["Operator"],
          summary: "Build a pilot handoff pack for one captured request.",
          security: [{ cookieAuth: [] }, { bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "format",
              in: "query",
              schema: { type: "string", enum: ["markdown"] },
              description: "Return the handoff pack as a Markdown download instead of JSON.",
            },
          ],
          responses: {
            "200": {
              description: "Pilot handoff pack with email draft, call agenda, success signals, and source integration commands.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PilotHandoffResponse" },
                },
                "text/markdown": {
                  schema: { type: "string" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "503": { $ref: "#/components/responses/OperatorAuthNotConfigured" },
          },
        },
      },
      "/api/snapshot": {
        get: {
          tags: ["Public"],
          summary: "Cockpit snapshot with demo data and any accepted source events.",
          security: [{ cookieAuth: [] }, { bearerAuth: [] }],
          parameters: [
            {
              name: "range",
              in: "query",
              schema: { type: "string", enum: ["24h", "7d", "30d"], default: "24h" },
            },
          ],
          responses: {
            "200": {
              description: "Operations cockpit snapshot.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OpsSnapshotResponse" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "503": { $ref: "#/components/responses/OperatorAuthNotConfigured" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "signalops_session",
        },
      },
      schemas: {
        StoreHealth: {
          type: "object",
          required: ["adapter", "durable", "ready", "missing"],
          properties: {
            adapter: { type: "string", enum: ["memory", "cloudflare_d1", "supabase"] },
            durable: { type: "boolean" },
            ready: { type: "boolean" },
            missing: { type: "array", items: { type: "string" } },
          },
        },
        StatusResponse: {
          type: "object",
          required: [
            "product",
            "stage",
            "canValidateEvents",
            "canAcceptPilotRequests",
            "canAcceptSourceEvents",
            "canClaimProductionReady",
            "storage",
            "requirements",
            "offer",
          ],
          properties: {
            product: { type: "string", const: "SignalOps" },
            stage: { type: "string", enum: ["hosted_demo", "pilot_setup"] },
            canValidateEvents: { type: "boolean" },
            canAcceptPilotRequests: { type: "boolean" },
            canAcceptSourceEvents: { type: "boolean" },
            canClaimProductionReady: { type: "boolean" },
            storage: { $ref: "#/components/schemas/StoreHealth" },
            requirements: { type: "object", additionalProperties: true },
            offer: { type: "string" },
          },
        },
        HealthResponse: {
          type: "object",
          required: [
            "ok",
            "service",
            "storage",
            "publicBaseUrl",
            "workspace",
            "eventValidation",
            "eventIngest",
            "privacy",
            "pilotIntake",
            "firstSourceEvent",
            "nextExternalSteps",
          ],
          properties: {
            ok: { type: "boolean" },
            service: { type: "string", const: "signalops" },
            storage: { $ref: "#/components/schemas/StoreHealth" },
            publicBaseUrl: {
              type: "object",
              required: ["ready", "url", "requiresHttps"],
              properties: {
                ready: { type: "boolean" },
                url: { type: "string" },
                requiresHttps: { type: "boolean", const: true },
              },
            },
            workspace: {
              type: "object",
              required: ["workspaceSlug", "configured", "pilotReady", "reason"],
              properties: {
                workspaceSlug: { type: "string" },
                configured: { type: "boolean" },
                pilotReady: { type: "boolean" },
                reason: { type: "string", enum: ["configured", "missing", "default_demo", "placeholder"] },
              },
            },
            eventValidation: { type: "object", additionalProperties: true },
            eventIngest: {
              type: "object",
              additionalProperties: true,
              properties: {
                policy: { $ref: "#/components/schemas/IngestPolicy" },
              },
            },
            pilotIntake: {
              type: "object",
              additionalProperties: true,
              properties: {
                maxBodyBytes: { type: "integer", default: 32768 },
                maxBodyKb: { type: "integer", default: 32 },
                deliveryTimeoutMs: { type: "integer", default: 5000 },
                acceptedContentTypes: { type: "array", items: { type: "string" } },
              },
            },
            privacy: {
              type: "object",
              required: ["ready", "mode", "defaultRedactsSensitiveFields", "sensitiveFields"],
              properties: {
                ready: { type: "boolean" },
                mode: { type: "string", enum: ["redact", "raw"] },
                defaultRedactsSensitiveFields: { type: "boolean", const: true },
                sensitiveFields: { type: "array", items: { type: "string", enum: ["user", "prompt"] } },
              },
            },
            firstSourceEvent: {
              type: "object",
              required: ["ready", "durable", "checked", "workspaceSlug"],
              properties: {
                ready: { type: "boolean" },
                durable: { type: "boolean" },
                checked: { type: "boolean" },
                workspaceSlug: { type: "string" },
                error: { type: "string" },
              },
            },
            nextExternalSteps: { type: "array", items: { type: "string" } },
          },
        },
        IngestPolicy: {
          type: "object",
          required: ["maxBatchEvents", "maxBodyBytes", "maxBodyKb", "privacyMode"],
          properties: {
            maxBatchEvents: {
              type: "integer",
              default: defaultMaxBatchEvents,
              minimum: 1,
              maximum: 1000,
            },
            maxBodyBytes: {
              type: "integer",
              default: defaultMaxBodyBytes,
              minimum: 1024,
              maximum: 1048576,
            },
            maxBodyKb: { type: "integer" },
            privacyMode: { type: "string", enum: ["redact", "raw"] },
          },
        },
        RateLimitPolicy: {
          type: "object",
          required: ["mode", "windowMs", "buckets"],
          properties: {
            mode: { type: "string", const: "instance_memory" },
            windowMs: { type: "integer", default: 60000, minimum: 1000, maximum: 300000 },
            buckets: {
              type: "object",
              required: ["event_validation", "event_ingest", "pilot_request"],
              properties: {
                event_validation: { type: "integer", default: 60, minimum: 1, maximum: 10000 },
                event_ingest: { type: "integer", default: 120, minimum: 1, maximum: 10000 },
                pilot_request: { type: "integer", default: 10, minimum: 1, maximum: 10000 },
              },
            },
          },
        },
        SetupGate: {
          type: "object",
          required: ["id", "label", "ready", "detail", "commands"],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            ready: { type: "boolean" },
            detail: { type: "string" },
            commands: { type: "array", items: { type: "string" } },
          },
        },
        SetupPlanResponse: {
          type: "object",
          required: ["ok", "plan"],
          properties: {
            ok: { type: "boolean" },
            plan: {
              type: "object",
              required: ["stage", "readyCount", "totalCount", "gates", "nextExternalSteps"],
              properties: {
                stage: { type: "string", enum: ["hosted_demo", "pilot_setup"] },
                readyCount: { type: "integer" },
                totalCount: { type: "integer" },
                gates: { type: "array", items: { $ref: "#/components/schemas/SetupGate" } },
                nextExternalSteps: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        SourceKitResponse: {
          type: "object",
          required: ["ok", "kit"],
          properties: {
            ok: { type: "boolean" },
            kit: {
              type: "object",
              required: [
                "product",
                "baseUrl",
                "packageName",
                "sdkVersion",
                "distribution",
                "compatibility",
                "idempotency",
                "storageStrategy",
                "requiredServerEnv",
                "operatorEnv",
                "endpoints",
                "ingestPolicy",
                "rateLimitPolicy",
                "pilotIntakePolicy",
                "sampleEvent",
                "snippets",
                "verification",
              ],
              properties: {
                product: { type: "string", const: "SignalOps" },
                baseUrl: { type: "string", format: "uri" },
                packageName: { type: "string", const: "@signalops/node" },
                sdkVersion: { type: "string" },
                distribution: {
                  type: "object",
                  required: ["status", "npmPublished"],
                  properties: {
                    status: { type: "string", enum: ["workspace_preview"] },
                    npmPublished: { type: "boolean", const: false },
                  },
                },
                compatibility: {
                  type: "object",
                  required: [
                    "minSdkVersion",
                    "validationResultIncludesIngestPolicy",
                    "validationResultIncludesDiagnostics",
                    "ingestResponseIncludesReceipt",
                    "ingestResponseIncludesDuplicateEventIds",
                    "failOpenRecommended",
                  ],
                  properties: {
                    minSdkVersion: { type: "string" },
                    validationResultIncludesIngestPolicy: { type: "boolean", const: true },
                    validationResultIncludesDiagnostics: { type: "boolean", const: true },
                    ingestResponseIncludesReceipt: { type: "boolean", const: true },
                    ingestResponseIncludesDuplicateEventIds: { type: "boolean", const: true },
                    failOpenRecommended: { type: "boolean", const: true },
                  },
                },
                idempotency: {
                  type: "object",
                  required: [
                    "eventIdMaxLength",
                    "serverDefault",
                    "callerRequiredFor",
                    "retryContract",
                    "helper",
                    "examples",
                  ],
                  properties: {
                    eventIdMaxLength: { type: "integer", const: 160 },
                    serverDefault: { type: "string" },
                    callerRequiredFor: { type: "array", items: { type: "string" } },
                    retryContract: { type: "string" },
                    helper: {
                      type: "object",
                      required: ["name", "import"],
                      properties: {
                        name: { type: "string", const: "createSignalOpsEventId" },
                        import: { type: "string" },
                      },
                    },
                    examples: {
                      type: "object",
                      required: ["generationCompleted", "providerHealth", "costRecorded"],
                      properties: {
                        generationCompleted: { type: "string" },
                        providerHealth: { type: "string" },
                        costRecorded: { type: "string" },
                      },
                    },
                  },
                },
                storageStrategy: {
                  type: "object",
                  required: [
                    "mode",
                    "newResourcesAllowed",
                    "preferredTargets",
                    "discoveryCommand",
                    "schemaCommands",
                    "note",
                  ],
                  properties: {
                    mode: { type: "string", const: "reuse_existing_resource" },
                    newResourcesAllowed: { type: "boolean", const: false },
                    preferredTargets: {
                      type: "array",
                      items: { type: "string", enum: ["cloudflare_d1_existing", "supabase_existing"] },
                    },
                    discoveryCommand: { type: "string" },
                    schemaCommands: { type: "array", items: { type: "string" } },
                    note: { type: "string" },
                  },
                },
                requiredServerEnv: { type: "array", items: { type: "string" } },
                operatorEnv: { type: "array", items: { type: "string" } },
                endpoints: { type: "object", additionalProperties: { type: "string", format: "uri" } },
                ingestPolicy: { $ref: "#/components/schemas/IngestPolicy" },
                rateLimitPolicy: { $ref: "#/components/schemas/RateLimitPolicy" },
                pilotIntakePolicy: {
                  type: "object",
                  required: ["maxBodyBytes", "maxBodyKb", "deliveryTimeoutMs", "acceptedContentTypes"],
                  properties: {
                    maxBodyBytes: { type: "integer", default: 32768 },
                    maxBodyKb: { type: "integer", default: 32 },
                    deliveryTimeoutMs: { type: "integer", default: 5000 },
                    acceptedContentTypes: { type: "array", items: { type: "string" } },
                  },
                },
                sampleEvent: { $ref: "#/components/schemas/SignalEventInput" },
                snippets: { type: "object", additionalProperties: { type: "string" } },
                verification: {
                  type: "object",
                  required: ["readinessGates", "expectedPreCutover", "commands"],
                  properties: {
                    readinessGates: { type: "array", items: { type: "string" } },
                    expectedPreCutover: {
                      type: "object",
                      required: ["stage", "unauthenticatedIngestStatus", "storageGateCode"],
                      properties: {
                        stage: { type: "string", const: "hosted_demo" },
                        unauthenticatedIngestStatus: { type: "integer", const: 401 },
                        storageGateCode: { type: "string", const: "ingest_storage_not_configured" },
                      },
                    },
                    commands: {
                      type: "object",
                      required: [
                        "softPreflight",
                        "strictPreflight",
                        "sourceSmoke",
                        "sourceReportByEvent",
                        "sourceReportJson",
                        "sourceReportMarkdown",
                      ],
                      properties: {
                        softPreflight: { type: "string" },
                        strictPreflight: { type: "string" },
                        sourceSmoke: { type: "string" },
                        sourceReportByEvent: { type: "string" },
                        sourceReportJson: { type: "string" },
                        sourceReportMarkdown: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        OpsSnapshotResponse: {
          type: "object",
          required: [
            "generatedAt",
            "sourceOverlay",
            "providers",
            "models",
            "generations",
            "timeline",
            "incidents",
            "consumers",
            "activeRoutingRule",
          ],
          additionalProperties: true,
          properties: {
            generatedAt: { type: "string", format: "date-time" },
            sourceOverlay: { $ref: "#/components/schemas/OpsSnapshotSourceOverlay" },
            providers: { type: "array", items: { type: "object", additionalProperties: true } },
            models: { type: "array", items: { type: "object", additionalProperties: true } },
            generations: { type: "array", items: { type: "object", additionalProperties: true } },
            timeline: { type: "array", items: { type: "object", additionalProperties: true } },
            incidents: { type: "array", items: { type: "object", additionalProperties: true } },
            consumers: { type: "array", items: { type: "object", additionalProperties: true } },
            activeRoutingRule: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
          },
        },
        OpsSnapshotSourceOverlay: {
          type: "object",
          required: [
            "demoDataIncluded",
            "sourceEventsIncluded",
            "durableSourceStorage",
            "sourceEventCount",
            "sourceGenerationCount",
            "sourceProviders",
            "sourceModels",
            "sourceOnlyReportPath",
          ],
          properties: {
            demoDataIncluded: { type: "boolean", const: true },
            sourceEventsIncluded: { type: "boolean" },
            durableSourceStorage: { type: "boolean" },
            sourceEventCount: { type: "integer" },
            sourceGenerationCount: { type: "integer" },
            sourceProviders: { type: "array", items: { type: "string" } },
            sourceModels: { type: "array", items: { type: "string" } },
            sourceOnlyReportPath: { type: "string" },
          },
        },
        SignalEventInput: {
          type: "object",
          required: ["type"],
          properties: {
            eventId: { type: "string", maxLength: 160 },
            type: {
              type: "string",
              enum: [
                "generation.started",
                "generation.completed",
                "generation.failed",
                "generation.retrying",
                "provider.health",
                "cost.recorded",
              ],
            },
            occurredAt: { type: "string", format: "date-time" },
            generationId: { type: "string", maxLength: 120 },
            providerId: { type: "string", maxLength: 80 },
            modelId: { type: "string", maxLength: 120 },
            status: {
              type: "string",
              enum: ["queued", "running", "succeeded", "failed", "retrying", "blocked"],
            },
            source: { type: "string", maxLength: 80 },
            durationMs: { type: "number", minimum: 0 },
            cost: { type: "number", minimum: 0 },
            retryCount: { type: "integer", minimum: 0 },
            user: { type: "string", maxLength: 240 },
            prompt: { type: "string", maxLength: 2000 },
          },
        },
        SignalEventBatchInput: {
          type: "object",
          required: ["events"],
          properties: {
            events: {
              type: "array",
              maxItems: 100,
              items: { $ref: "#/components/schemas/SignalEventInput" },
            },
          },
        },
        EventValidationResponse: {
          type: "object",
          required: [
            "ok",
            "verificationOnly",
            "validEvents",
            "rejectedEvents",
            "eventTypes",
            "providerIds",
            "modelIds",
            "privacyMode",
            "diagnostics",
            "storedEvents",
            "rejected",
            "requestId",
          ],
          properties: {
            ok: { type: "boolean" },
            verificationOnly: { type: "boolean", const: true },
            validEvents: { type: "integer" },
            rejectedEvents: { type: "integer" },
            eventTypes: { type: "array", items: { type: "string" } },
            providerIds: { type: "array", items: { type: "string" } },
            modelIds: { type: "array", items: { type: "string" } },
            privacyMode: { type: "string", enum: ["redact", "raw"] },
            diagnostics: { $ref: "#/components/schemas/SignalEventDiagnostics" },
            ingestPolicy: { $ref: "#/components/schemas/IngestPolicy" },
            storedEvents: { type: "integer", const: 0 },
            rejected: { type: "array", items: { type: "object", additionalProperties: true } },
            requestId: { type: "string" },
          },
        },
        SignalEventDiagnostics: {
          type: "object",
          required: ["readiness", "coverage", "gaps", "nextActions"],
          properties: {
            readiness: { type: "string", enum: ["insufficient", "partial", "pilot_ready"] },
            coverage: {
              type: "object",
              required: ["generationLifecycle", "providerHealth", "latency", "cost", "retries", "providers", "models"],
              properties: {
                generationLifecycle: {
                  type: "object",
                  required: ["started", "completed", "failed", "retrying"],
                  properties: {
                    started: { type: "boolean" },
                    completed: { type: "boolean" },
                    failed: { type: "boolean" },
                    retrying: { type: "boolean" },
                  },
                },
                providerHealth: { type: "boolean" },
                latency: { type: "boolean" },
                cost: { type: "boolean" },
                retries: { type: "boolean" },
                providers: { type: "integer" },
                models: { type: "integer" },
              },
            },
            gaps: { type: "array", items: { type: "string" } },
            nextActions: { type: "array", items: { type: "string" } },
          },
        },
        EventIngestResponse: {
          type: "object",
          required: [
            "ok",
            "accepted",
            "storedEvents",
            "duplicateEvents",
            "storedEventIds",
            "duplicateEventIds",
            "receipt",
            "diagnostics",
            "rejected",
            "requestId",
          ],
          properties: {
            ok: { type: "boolean" },
            accepted: { type: "integer" },
            storedEvents: { type: "integer" },
            duplicateEvents: { type: "integer" },
            storedEventIds: { type: "array", items: { type: "string" } },
            duplicateEventIds: { type: "array", items: { type: "string" } },
            receipt: { $ref: "#/components/schemas/SourceEventReceipt" },
            diagnostics: { $ref: "#/components/schemas/SignalEventDiagnostics" },
            rejected: { type: "array", items: { type: "object", additionalProperties: true } },
            ingestPolicy: { $ref: "#/components/schemas/IngestPolicy" },
            alerts: {
              type: "object",
              additionalProperties: true,
              description: "Alert evaluation and optional webhook delivery summary. Alert delivery is fail-open.",
            },
            requestId: { type: "string" },
          },
        },
        SourceEventReceipt: {
          type: "object",
          required: [
            "type",
            "requestId",
            "workspaceSlug",
            "acceptedEventIds",
            "storedEventIds",
            "duplicateEvents",
            "duplicateEventIds",
            "storage",
            "proof",
            "nextActions",
          ],
          properties: {
            type: { type: "string", const: "signalops.source_event_receipt" },
            requestId: { type: "string" },
            workspaceSlug: { type: "string" },
            acceptedEventIds: { type: "array", items: { type: "string" } },
            storedEventIds: { type: "array", items: { type: "string" } },
            duplicateEvents: { type: "integer" },
            duplicateEventIds: { type: "array", items: { type: "string" } },
            storage: {
              type: "object",
              required: ["adapter", "durable", "ready"],
              properties: {
                adapter: { type: "string", enum: ["memory", "cloudflare_d1", "supabase"] },
                durable: { type: "boolean" },
                ready: { type: "boolean" },
              },
            },
            proof: {
              type: "object",
              required: [
                "demoDataIncluded",
                "sourceOnlyReportPath",
                "exactSourceReportPath",
                "durableWrite",
                "existingEventCandidate",
                "firstSourceEventCandidate",
              ],
              properties: {
                demoDataIncluded: { type: "boolean", const: false },
                sourceOnlyReportPath: { type: "string" },
                exactSourceReportPath: { type: ["string", "null"] },
                durableWrite: { type: "boolean" },
                existingEventCandidate: { type: "boolean" },
                firstSourceEventCandidate: { type: "boolean" },
              },
            },
            nextActions: { type: "array", items: { type: "string" } },
          },
        },
        SourceReportResponse: {
          type: "object",
          required: ["ok", "storage", "limit", "report", "requestId"],
          properties: {
            ok: { type: "boolean", const: true },
            storage: { $ref: "#/components/schemas/StoreHealth" },
            limit: { type: "integer" },
            report: { $ref: "#/components/schemas/SourceOperationalReport" },
            requestId: { type: "string" },
          },
        },
        SourceOperationalReport: {
          type: "object",
          required: [
            "workspaceSlug",
            "generatedAt",
            "sourceOnly",
            "demoDataIncluded",
            "filters",
            "totalEvents",
            "generationEvents",
            "providerHealthEvents",
            "costEvents",
            "storedEventWindow",
            "diagnostics",
            "providers",
            "models",
            "risks",
            "nextActions",
            "pilotEvidence",
            "operatorBrief",
          ],
          properties: {
            workspaceSlug: { type: "string" },
            generatedAt: { type: "string", format: "date-time" },
            sourceOnly: { type: "boolean", const: true },
            demoDataIncluded: { type: "boolean", const: false },
            filters: { $ref: "#/components/schemas/SourceReportFilters" },
            totalEvents: { type: "integer" },
            generationEvents: { type: "integer" },
            providerHealthEvents: { type: "integer" },
            costEvents: { type: "integer" },
            storedEventWindow: {
              type: "object",
              properties: {
                firstSeenAt: { type: "string", format: "date-time" },
                lastSeenAt: { type: "string", format: "date-time" },
              },
            },
            diagnostics: { $ref: "#/components/schemas/SignalEventDiagnostics" },
            providers: {
              type: "array",
              items: { $ref: "#/components/schemas/SourceProviderReport" },
            },
            models: {
              type: "array",
              items: { $ref: "#/components/schemas/SourceModelReport" },
            },
            risks: { type: "array", items: { type: "string" } },
            nextActions: { type: "array", items: { type: "string" } },
            pilotEvidence: { $ref: "#/components/schemas/SourcePilotEvidence" },
            operatorBrief: { $ref: "#/components/schemas/SourceOperatorBrief" },
          },
        },
        SourceOperatorBrief: {
          type: "object",
          required: ["decision", "headline", "talkingPoints", "proofChecklist", "nonGoals"],
          properties: {
            decision: {
              type: "string",
              enum: ["wait_for_source_event", "review_narrow_pilot", "pilot_review_ready"],
            },
            headline: { type: "string" },
            talkingPoints: { type: "array", items: { type: "string" } },
            proofChecklist: { type: "array", items: { type: "string" } },
            nonGoals: { type: "array", items: { type: "string" } },
          },
        },
        SourcePilotEvidence: {
          type: "object",
          required: ["level", "readyForOperatorReview", "summary", "missingCoverage", "recommendedScope"],
          properties: {
            level: { type: "string", enum: ["none", "partial", "pilot_ready"] },
            readyForOperatorReview: { type: "boolean" },
            summary: { type: "string" },
            missingCoverage: { type: "array", items: { type: "string" } },
            recommendedScope: { type: "array", items: { type: "string" } },
          },
        },
        SourceReportFilters: {
          type: "object",
          required: ["range"],
          properties: {
            range: { type: "string", enum: ["all", "24h", "7d", "30d"] },
            eventId: { type: "string" },
            providerId: { type: "string" },
            modelId: { type: "string" },
          },
        },
        SourceProviderReport: {
          type: "object",
          required: [
            "providerId",
            "eventCount",
            "generationCount",
            "successCount",
            "failureCount",
            "retryCount",
            "successRate",
            "failureRate",
            "retryRate",
            "p95Ms",
            "totalCost",
            "models",
            "lastSeenAt",
            "status",
          ],
          properties: {
            providerId: { type: "string" },
            eventCount: { type: "integer" },
            generationCount: { type: "integer" },
            successCount: { type: "integer" },
            failureCount: { type: "integer" },
            retryCount: { type: "integer" },
            successRate: { type: "number" },
            failureRate: { type: "number" },
            retryRate: { type: "number" },
            p95Ms: { oneOf: [{ type: "number" }, { type: "null" }] },
            totalCost: { type: "number" },
            models: { type: "array", items: { type: "string" } },
            lastSeenAt: { type: "string", format: "date-time" },
            status: { type: "string", enum: ["healthy", "watch", "degraded"] },
          },
        },
        SourceModelReport: {
          type: "object",
          required: [
            "modelId",
            "providerId",
            "generationCount",
            "successRate",
            "failureRate",
            "p95Ms",
            "totalCost",
            "lastSeenAt",
          ],
          properties: {
            modelId: { type: "string" },
            providerId: { type: "string" },
            generationCount: { type: "integer" },
            successRate: { type: "number" },
            failureRate: { type: "number" },
            p95Ms: { oneOf: [{ type: "number" }, { type: "null" }] },
            totalCost: { type: "number" },
            lastSeenAt: { type: "string", format: "date-time" },
          },
        },
        PilotRequestInput: {
          type: "object",
          required: [
            "name",
            "email",
            "generationVolume",
            "providers",
            "primaryPain",
            "urgency",
            "desiredOutcome",
            "useCase",
          ],
          properties: {
            name: { type: "string", maxLength: 120 },
            email: { type: "string", format: "email", maxLength: 180 },
            company: { type: "string", maxLength: 160 },
            productUrl: { type: "string", maxLength: 240 },
            generationVolume: { type: "string", maxLength: 120 },
            providers: { type: "string", maxLength: 240 },
            primaryPain: { type: "string", maxLength: 500 },
            urgency: { type: "string", enum: ["exploring", "this_month", "blocked_now"] },
            desiredOutcome: { type: "string", maxLength: 500 },
            useCase: { type: "string", minLength: 20, maxLength: 1400 },
            source: { type: "string", maxLength: 80 },
            website: {
              type: "string",
              maxLength: 240,
              description: "Hidden honeypot field. Human submissions should leave it empty.",
            },
          },
        },
        PilotQualification: {
          type: "object",
          required: ["tier", "signals"],
          properties: {
            tier: { type: "string", enum: ["evaluate", "strong_fit", "urgent_fit"] },
            signals: { type: "array", items: { type: "string" } },
          },
        },
        PilotRequestLifecycle: {
          type: "object",
          required: ["status", "updatedAt"],
          properties: {
            status: { type: "string", enum: ["new", "contacted", "pilot_scoped", "closed"] },
            operatorNote: { type: "string", maxLength: 1200 },
            nextActionAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        PilotRequestActivity: {
          type: "object",
          required: ["id", "pilotRequestId", "type", "actor", "summary", "createdAt"],
          properties: {
            id: { type: "string" },
            pilotRequestId: { type: "string" },
            type: { type: "string", enum: ["submitted", "lifecycle_updated"] },
            actor: { type: "string", enum: ["system", "operator"] },
            status: { type: "string", enum: ["new", "contacted", "pilot_scoped", "closed"] },
            summary: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        PilotRequest: {
          type: "object",
          required: ["id", "createdAt", "name", "email", "useCase", "source", "qualification", "lifecycle", "activity"],
          properties: {
            id: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
            company: { type: "string" },
            productUrl: { type: "string" },
            generationVolume: { type: "string" },
            providers: { type: "string" },
            primaryPain: { type: "string" },
            urgency: { type: "string", enum: ["exploring", "this_month", "blocked_now"] },
            desiredOutcome: { type: "string" },
            useCase: { type: "string" },
            source: { type: "string" },
            qualification: { $ref: "#/components/schemas/PilotQualification" },
            lifecycle: { $ref: "#/components/schemas/PilotRequestLifecycle" },
            activity: {
              type: "array",
              items: { $ref: "#/components/schemas/PilotRequestActivity" },
            },
          },
        },
        PilotRequestListResponse: {
          type: "object",
          required: ["ok", "storage", "limit", "filters", "count", "summary", "pilotRequests", "requestId"],
          properties: {
            ok: { type: "boolean", const: true },
            storage: { $ref: "#/components/schemas/StoreHealth" },
            limit: { type: "integer" },
            filters: { $ref: "#/components/schemas/PilotRequestOperatorFilters" },
            count: { type: "integer" },
            summary: { $ref: "#/components/schemas/PilotRequestOperatorSummary" },
            pilotRequests: {
              type: "array",
              items: { $ref: "#/components/schemas/PilotRequest" },
            },
            requestId: { type: "string" },
          },
        },
        PilotRequestOperatorFilters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["new", "contacted", "pilot_scoped", "closed"] },
            tier: { type: "string", enum: ["evaluate", "strong_fit", "urgent_fit"] },
            followUp: { type: "string", enum: ["all", "open", "due", "unscheduled"] },
          },
        },
        PilotRequestOperatorSummary: {
          type: "object",
          required: [
            "total",
            "openCount",
            "urgentOpenCount",
            "needsFollowUpCount",
            "unscheduledOpenCount",
            "byStatus",
            "byTier",
          ],
          properties: {
            total: { type: "integer" },
            openCount: { type: "integer" },
            urgentOpenCount: { type: "integer" },
            needsFollowUpCount: { type: "integer" },
            unscheduledOpenCount: { type: "integer" },
            byStatus: { type: "object", additionalProperties: { type: "integer" } },
            byTier: { type: "object", additionalProperties: { type: "integer" } },
            latestCreatedAt: { type: "string", format: "date-time" },
            nextActionDueAt: { type: "string", format: "date-time" },
          },
        },
        PilotHandoffResponse: {
          type: "object",
          required: ["ok", "storage", "handoff", "requestId"],
          properties: {
            ok: { type: "boolean", const: true },
            storage: { $ref: "#/components/schemas/StoreHealth" },
            handoff: { $ref: "#/components/schemas/PilotHandoffPack" },
            requestId: { type: "string" },
          },
        },
        PilotHandoffPack: {
          type: "object",
          required: [
            "pilotRequestId",
            "generatedAt",
            "company",
            "contact",
            "qualification",
            "recommendedPilot",
            "emailDraft",
            "callAgenda",
            "acceptanceChecklist",
            "sourceIntegration",
            "markdown",
          ],
          properties: {
            pilotRequestId: { type: "string" },
            generatedAt: { type: "string", format: "date-time" },
            company: { type: "string" },
            contact: {
              type: "object",
              required: ["name", "email"],
              properties: {
                name: { type: "string" },
                email: { type: "string", format: "email" },
                productUrl: { type: "string", format: "uri" },
              },
            },
            qualification: { $ref: "#/components/schemas/PilotQualification" },
            recommendedPilot: {
              type: "object",
              required: ["targetOutcome", "scope", "successSignals", "nextSteps"],
              properties: {
                targetOutcome: { type: "string" },
                scope: { type: "array", items: { type: "string" } },
                successSignals: { type: "array", items: { type: "string" } },
                nextSteps: { type: "array", items: { type: "string" } },
              },
            },
            emailDraft: {
              type: "object",
              required: ["subject", "body"],
              properties: {
                subject: { type: "string" },
                body: { type: "string" },
              },
            },
            callAgenda: { type: "array", items: { type: "string" } },
            acceptanceChecklist: {
              type: "object",
              required: ["preCall", "firstEventProof", "operatorReview", "nonGoals"],
              properties: {
                preCall: { type: "array", items: { type: "string" } },
                firstEventProof: { type: "array", items: { type: "string" } },
                operatorReview: { type: "array", items: { type: "string" } },
                nonGoals: { type: "array", items: { type: "string" } },
              },
            },
            sourceIntegration: {
              type: "object",
              required: [
                "requiredServerEnv",
                "validateEndpoint",
                "ingestEndpoint",
                "sampleEvent",
                "validateCurl",
                "ingestCurl",
                "curl",
                "nodeSnippet",
                "preflightCommands",
              ],
              properties: {
                requiredServerEnv: { type: "array", items: { type: "string" } },
                validateEndpoint: { type: "string", format: "uri" },
                ingestEndpoint: { type: "string", format: "uri" },
                sampleEvent: { $ref: "#/components/schemas/SignalEventInput" },
                validateCurl: { type: "string" },
                ingestCurl: { type: "string" },
                curl: { type: "string" },
                nodeSnippet: { type: "string" },
                preflightCommands: { type: "array", items: { type: "string" } },
              },
            },
            markdown: { type: "string" },
          },
        },
        PilotRequestLifecycleUpdateInput: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["new", "contacted", "pilot_scoped", "closed"] },
            operatorNote: { type: "string", maxLength: 1200 },
            nextActionAt: {
              oneOf: [
                { type: "string", format: "date-time" },
                { type: "null" },
              ],
            },
          },
        },
        PilotRequestLifecycleUpdateResponse: {
          type: "object",
          required: ["ok", "storage", "pilotRequest", "requestId"],
          properties: {
            ok: { type: "boolean", const: true },
            storage: { $ref: "#/components/schemas/StoreHealth" },
            pilotRequest: { $ref: "#/components/schemas/PilotRequest" },
            requestId: { type: "string" },
          },
        },
        PilotRequestAcceptedResponse: {
          type: "object",
          required: ["ok", "pilotRequestId", "qualification", "deliveries", "requestId"],
          properties: {
            ok: { type: "boolean" },
            pilotRequestId: { type: "string" },
            qualification: { $ref: "#/components/schemas/PilotQualification" },
            deliveries: { type: "array", items: { $ref: "#/components/schemas/PilotDeliveryResult" } },
            requestId: { type: "string" },
          },
        },
        PilotDeliveryResult: {
          type: "object",
          required: ["target", "ok", "deliveryId", "attemptedAt"],
          properties: {
            target: {
              type: "string",
              enum: ["storage", "ephemeral_storage", "webhook", "alert_webhook", "email"],
            },
            ok: { type: "boolean" },
            deliveryId: { type: "string" },
            attemptedAt: { type: "string", format: "date-time" },
            durationMs: { type: "number", minimum: 0 },
            status: { type: "integer" },
            signed: { type: "boolean" },
            error: { type: "string" },
          },
        },
        ErrorResponse: {
          type: "object",
          required: ["ok", "code", "requestId"],
          properties: {
            ok: { type: "boolean", const: false },
            code: { type: "string" },
            error: { type: "string" },
            qualification: { $ref: "#/components/schemas/PilotQualification" },
            deliveries: { type: "array", items: { $ref: "#/components/schemas/PilotDeliveryResult" } },
            fallbackEmail: { type: "string", format: "email" },
            fallbackPackage: { $ref: "#/components/schemas/PilotRequestFallbackPackage" },
            requestId: { type: "string" },
          },
        },
        PilotRequestFallbackPackage: {
          type: "object",
          required: [
            "type",
            "createdAt",
            "requestId",
            "qualification",
            "request",
            "operatorNextActions",
            "acceptanceChecklist",
            "sourceEventSample",
          ],
          properties: {
            type: { type: "string", const: "signalops.pilot_request" },
            createdAt: { type: "string", format: "date-time" },
            requestId: { type: "string" },
            qualification: { $ref: "#/components/schemas/PilotQualification" },
            request: { $ref: "#/components/schemas/PilotRequest" },
            links: {
              type: "object",
              properties: {
                sourceKit: { type: "string", format: "uri" },
                docs: { type: "string", format: "uri" },
                publicStatus: { type: "string", format: "uri" },
                setup: { type: "string", format: "uri" },
              },
            },
            integration: {
              type: "object",
              properties: {
                validateFirst: { type: "boolean", const: true },
                requiredServerEnv: { type: "array", items: { type: "string" } },
                preflightCommands: { type: "array", items: { type: "string" } },
              },
            },
            operatorNextActions: { type: "array", items: { type: "string" } },
            acceptanceChecklist: {
              type: "object",
              required: ["preCall", "firstEventProof", "nonGoals"],
              properties: {
                preCall: { type: "array", items: { type: "string" } },
                firstEventProof: { type: "array", items: { type: "string" } },
                nonGoals: { type: "array", items: { type: "string" } },
              },
            },
            sourceEventSample: { $ref: "#/components/schemas/SignalEventInput" },
          },
        },
      },
      responses: {
        InvalidJson: {
          description: "Request body could not be parsed as JSON.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        PayloadTooLarge: {
          description: "Request body exceeds the ingest payload limit.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        UnsupportedMediaType: {
          description: "Request content-type is not supported by this endpoint.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        RateLimited: {
          description: "Per-instance free-tier safety rate limit was exceeded. Honor Retry-After before retrying.",
          headers: {
            "Retry-After": {
              schema: { type: "integer" },
              description: "Seconds until the current in-memory rate-limit window resets.",
            },
            "X-RateLimit-Limit": {
              schema: { type: "integer" },
              description: "Allowed requests in the current window for this bucket.",
            },
            "X-RateLimit-Remaining": {
              schema: { type: "integer" },
              description: "Remaining requests in the current window for this bucket.",
            },
            "X-RateLimit-Reset": {
              schema: { type: "string", format: "date-time" },
              description: "ISO timestamp for the current window reset.",
            },
          },
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        InvalidEvent: {
          description: "Event payload failed contract validation.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        Unauthorized: {
          description: "Missing or invalid bearer token.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        IngestStorageNotConfigured: {
          description:
            "Production ingest is blocked until durable storage and real workspace identity are configured.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        InvalidPilotRequest: {
          description: "Pilot request payload failed validation.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        PilotDeliveryFailed: {
          description: "Configured pilot delivery targets all failed.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        PilotIntakeNotConfigured: {
          description: "Pilot intake is blocked until storage, webhook, or email delivery is configured.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        InvalidPilotRequestLifecycleUpdate: {
          description: "Pilot request lifecycle update failed validation.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        NotFound: {
          description: "Requested resource was not found.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        OperatorAuthNotConfigured: {
          description: "Operator auth must be configured before reading pilot requests in production.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
      },
    },
  } as const;
}
