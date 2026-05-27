export type ProviderId = "google" | "fal" | "openai" | "alibaba";
export type GenerationStatus =
  | "succeeded"
  | "failed"
  | "running"
  | "queued"
  | "retrying"
  | "blocked";
export type GenerationSource =
  | "canvas"
  | "template"
  | "photo-me"
  | "upscale"
  | "inpaint";

export type Provider = {
  id: ProviderId;
  name: string;
  status: "healthy" | "degraded" | "incident";
  region: string;
  p95Ms: number;
  failureRate: number;
  spend: number;
  volume: number;
  color: string;
};

export type Model = {
  id: string;
  name: string;
  providerId: ProviderId;
  medianMs: number;
  p95Ms: number;
  costPerImage: number;
  successRate: number;
  volume: number;
};

export type Generation = {
  id: string;
  createdAt: string;
  user: string;
  prompt: string;
  modelId: string;
  providerId: ProviderId;
  source: GenerationSource;
  status: GenerationStatus;
  durationMs: number;
  cost: number;
  credits: number;
  retryCount: number;
};

export type TimeBucket = {
  time: string;
  volume: number;
  failures: number;
  latency: number;
  spend: number;
};

export type Incident = {
  id: string;
  title: string;
  providerId: ProviderId;
  severity: "info" | "warning" | "critical";
  age: string;
  detail: string;
};

export type Consumer = {
  id: string;
  name: string;
  plan: "free" | "starter" | "pro" | "studio";
  credits: number;
  spend: number;
  generations: number;
  failureRate: number;
};

export type OpsSnapshot = {
  generatedAt: string;
  providers: Provider[];
  models: Model[];
  generations: Generation[];
  timeline: TimeBucket[];
  incidents: Incident[];
  consumers: Consumer[];
};

const providers: Provider[] = [
  {
    id: "google",
    name: "Google AI",
    status: "healthy",
    region: "asia-southeast1",
    p95Ms: 8100,
    failureRate: 1.8,
    spend: 184.42,
    volume: 1384,
    color: "#3F9070",
  },
  {
    id: "fal",
    name: "fal.ai",
    status: "degraded",
    region: "iad",
    p95Ms: 14300,
    failureRate: 5.6,
    spend: 326.8,
    volume: 911,
    color: "#D89A3F",
  },
  {
    id: "openai",
    name: "OpenAI",
    status: "healthy",
    region: "us-east",
    p95Ms: 10700,
    failureRate: 2.7,
    spend: 217.12,
    volume: 574,
    color: "#3F7BC4",
  },
  {
    id: "alibaba",
    name: "Alibaba",
    status: "incident",
    region: "ap-southeast",
    p95Ms: 18800,
    failureRate: 9.1,
    spend: 92.35,
    volume: 288,
    color: "#C04B3A",
  },
];

const models: Model[] = [
  {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    providerId: "google",
    medianMs: 6900,
    p95Ms: 10400,
    costPerImage: 0.039,
    successRate: 98.4,
    volume: 882,
  },
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    providerId: "google",
    medianMs: 9100,
    p95Ms: 13300,
    costPerImage: 0.073,
    successRate: 97.9,
    volume: 502,
  },
  {
    id: "flux-2-pro",
    name: "FLUX 2 Pro",
    providerId: "fal",
    medianMs: 8200,
    p95Ms: 15100,
    costPerImage: 0.052,
    successRate: 94.7,
    volume: 437,
  },
  {
    id: "flux-2-max",
    name: "FLUX 2 Max",
    providerId: "fal",
    medianMs: 12200,
    p95Ms: 19400,
    costPerImage: 0.086,
    successRate: 93.2,
    volume: 221,
  },
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    providerId: "openai",
    medianMs: 10100,
    p95Ms: 14700,
    costPerImage: 0.11,
    successRate: 96.5,
    volume: 574,
  },
  {
    id: "qwen-image",
    name: "Qwen Image",
    providerId: "alibaba",
    medianMs: 11600,
    p95Ms: 20100,
    costPerImage: 0.041,
    successRate: 90.9,
    volume: 288,
  },
];

const prompts = [
  "Cyber oasis skyline with rain-slick neon streets",
  "Minimal tote bag mockup with calm morning tide artwork",
  "Editorial portrait in soft window light",
  "Glass observatory above a stormy mountain ridge",
  "Luxury product render, black ceramic bottle, amber rim light",
  "Retro travel poster, quiet beach at sunrise",
  "Arcade cabinet interface with glowing pixel glyphs",
  "Botanical packaging system with embossed paper texture",
  "Architectural section view of a compact creator studio",
  "Surreal chessboard floating over a flooded metro platform",
];

const users = [
  "maya@studio.dev",
  "ilya@phosphene.cc",
  "zoe@brandlab.ai",
  "kai@designops.co",
  "nina@atelier.one",
  "omar@motionworks.io",
  "vera@foundry.tools",
  "liam@northstar.app",
];

const statuses: GenerationStatus[] = [
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "running",
  "queued",
  "retrying",
  "failed",
  "blocked",
];

const sources: GenerationSource[] = [
  "canvas",
  "template",
  "photo-me",
  "upscale",
  "inpaint",
];

function pick<T>(items: T[], index: number) {
  return items[index % items.length];
}

function makeGenerations(): Generation[] {
  return Array.from({ length: 10_000 }, (_, index) => {
    const model = pick(models, index * 3 + (index % 5));
    const provider = providers.find((item) => item.id === model.providerId);
    const status = pick(statuses, index + (provider?.status === "incident" ? 2 : 0));
    const jitter = ((index * 997) % 4200) - 1200;
    const durationMs = Math.max(900, model.medianMs + jitter);
    const ageMinutes = index * 7 + (index % 4) * 3;

    return {
      id: `gen_${String(100_000 - index).padStart(6, "0")}`,
      createdAt: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
      user: pick(users, index * 2),
      prompt: pick(prompts, index),
      modelId: model.id,
      providerId: model.providerId,
      source: pick(sources, index + 1),
      status,
      durationMs,
      cost: Number((model.costPerImage * (status === "retrying" ? 1.6 : 1)).toFixed(3)),
      credits: status === "succeeded" ? Math.ceil(model.costPerImage * 250) : 0,
      retryCount: status === "retrying" || status === "failed" ? (index % 3) + 1 : 0,
    };
  });
}

const generations = makeGenerations();

const timeline: TimeBucket[] = Array.from({ length: 24 }, (_, index) => {
  const hour = 23 - index;
  const volume = 74 + ((index * 17) % 56) + (index > 16 ? 34 : 0);
  const failures = Math.round(volume * (index > 17 ? 0.08 : 0.025));
  const latency = 7600 + ((index * 823) % 5100) + (index > 17 ? 4200 : 0);

  return {
    time: `${hour.toString().padStart(2, "0")}:00`,
    volume,
    failures,
    latency,
    spend: Number((volume * (0.045 + (index % 5) * 0.007)).toFixed(2)),
  };
}).reverse();

const incidents: Incident[] = [
  {
    id: "inc_411",
    title: "Qwen Image timeout cluster",
    providerId: "alibaba",
    severity: "critical",
    age: "18m",
    detail: "p95 crossed 18s after regional queue saturation.",
  },
  {
    id: "inc_409",
    title: "FLUX retry pressure",
    providerId: "fal",
    severity: "warning",
    age: "42m",
    detail: "Retry rate is elevated on image-to-image jobs.",
  },
  {
    id: "inc_404",
    title: "Template volume spike",
    providerId: "google",
    severity: "info",
    age: "2h",
    detail: "New portrait template doubled peak canvas traffic.",
  },
];

const consumers: Consumer[] = [
  {
    id: "usr_01",
    name: "Maya Chen",
    plan: "studio",
    credits: 1260,
    spend: 184.2,
    generations: 418,
    failureRate: 1.4,
  },
  {
    id: "usr_02",
    name: "BrandLab",
    plan: "pro",
    credits: 840,
    spend: 122.9,
    generations: 311,
    failureRate: 4.9,
  },
  {
    id: "usr_03",
    name: "Northstar App",
    plan: "starter",
    credits: 390,
    spend: 58.4,
    generations: 147,
    failureRate: 2.2,
  },
  {
    id: "usr_04",
    name: "Atelier One",
    plan: "pro",
    credits: 314,
    spend: 46.1,
    generations: 120,
    failureRate: 7.6,
  },
];

export function getOpsSnapshot(range: "24h" | "7d" | "30d") {
  const multiplier = range === "24h" ? 1 : range === "7d" ? 5.8 : 18.4;

  return {
    generatedAt: new Date().toISOString(),
    providers: providers.map((provider) => ({
      ...provider,
      spend: Number((provider.spend * multiplier).toFixed(2)),
      volume: Math.round(provider.volume * multiplier),
    })),
    models: models.map((model) => ({
      ...model,
      volume: Math.round(model.volume * multiplier),
    })),
    generations,
    timeline,
    incidents,
    consumers: consumers.map((consumer) => ({
      ...consumer,
      credits: Math.round(consumer.credits * multiplier),
      spend: Number((consumer.spend * multiplier).toFixed(2)),
      generations: Math.round(consumer.generations * multiplier),
    })),
  } satisfies OpsSnapshot;
}

export async function fetchOpsSnapshot(range: "24h" | "7d" | "30d") {
  await new Promise((resolve) => setTimeout(resolve, 360));

  return getOpsSnapshot(range);
}
