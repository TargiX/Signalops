#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const scanRoots = [
  "README.md",
  "docs",
  "src/app",
  "src/components",
  "src/lib/signalops",
  "packages/signalops-node/src",
];
const textExtensions = new Set([".md", ".mdx", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"]);

function extension(filePath) {
  const match = /\.([^.]+)$/.exec(filePath);
  return match ? `.${match[1]}` : "";
}

function collectFiles(entry, files = []) {
  const absolute = join(root, entry);
  if (!existsSync(absolute)) {
    return files;
  }

  const stat = statSync(absolute);
  if (stat.isFile()) {
    if (textExtensions.has(extension(absolute))) {
      files.push(absolute);
    }
    return files;
  }

  for (const child of readdirSync(absolute)) {
    if ([".next", "dist", "node_modules"].includes(child)) {
      continue;
    }
    collectFiles(join(entry, child), files);
  }
  return files;
}

function isAllowedProductionReadyLine(line) {
  return /not production-ready/i.test(line) || /does not claim production readiness/i.test(line);
}

function isAllowedCustomerTrafficLine(line) {
  return (
    /does not claim production customer traffic/i.test(line) ||
    /not claiming .*production customer traffic/i.test(line) ||
    /until .*source traffic/i.test(line)
  );
}

const forbidden = [
  {
    id: "signalops_os",
    pattern: /SignalOps OS/i,
    message: "Do not frame SignalOps as an OS while it is still a hosted demo/pilot setup.",
  },
  {
    id: "agentic_infra",
    pattern: /Agentic AI Infrastructure/i,
    message: "Use concrete product framing instead of inflated category language.",
  },
  {
    id: "durable_store_ready",
    pattern: /Durable-store ready/i,
    message: "Do not imply durable storage is connected before the storage gate is proven.",
  },
  {
    id: "mature_version",
    pattern: /\bv2\.0\b/i,
    message: "Do not imply a mature version while the product is still pre-pilot.",
  },
  {
    id: "social_proof",
    pattern: /trusted by|customers? love|used by \d/i,
    message: "Do not claim customer/social proof before real pilots exist.",
  },
  {
    id: "new_d1_creation",
    pattern: /wrangler.*d1\s+create|(?:^|\s)d1\s+create/i,
    message: "Public runbooks must reuse existing D1/Supabase resources, not create new ones.",
  },
  {
    id: "production_ready_claim",
    pattern: /production-ready/i,
    message: "Production-ready can only appear as an explicit negative claim.",
    allowLine: isAllowedProductionReadyLine,
  },
  {
    id: "customer_traffic_claim",
    pattern: /production customer traffic/i,
    message: "Customer traffic claims must stay explicitly negative until real source traffic exists.",
    allowLine: isAllowedCustomerTrafficLine,
  },
];

const requiredFiles = [
  {
    path: "README.md",
    pattern: /SignalOps is not claiming real traces or production customer traffic yet/i,
    message: "README must state the real-traces/customer-traffic boundary.",
  },
  {
    path: "docs/signalops-env.template",
    pattern: /do not create a\s+#?\s*new Vercel project or new cloud database/is,
    message: "Env template must preserve the no-new-resource setup rule.",
  },
  {
    path: "src/lib/signalops/source-kit.ts",
    pattern: /newResourcesAllowed:\s*false/,
    message: "Source kit must expose that new cloud resources are not allowed from this workflow.",
  },
  {
    path: "src/lib/signalops/source-kit.ts",
    pattern: /mode:\s*"reuse_existing_resource"/,
    message: "Source kit must expose the existing-resource storage strategy.",
  },
];

const findings = [];
const files = scanRoots.flatMap((entry) => collectFiles(entry));

for (const file of files) {
  const relativePath = relative(root, file);
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of forbidden) {
      if (rule.pattern.test(line) && !(rule.allowLine?.(line) ?? false)) {
        findings.push({
          path: relativePath,
          line: index + 1,
          rule: rule.id,
          message: rule.message,
          text: line.trim(),
        });
      }
    }
  });
}

for (const requirement of requiredFiles) {
  const absolute = join(root, requirement.path);
  const text = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  if (!requirement.pattern.test(text)) {
    findings.push({
      path: requirement.path,
      line: 1,
      rule: "required_honesty_marker",
      message: requirement.message,
      text: "missing required marker",
    });
  }
}

if (findings.length > 0) {
  console.error("SignalOps claims honesty verification failed:");
  for (const finding of findings) {
    console.error(`- ${finding.path}:${finding.line} [${finding.rule}] ${finding.message}`);
    console.error(`  ${finding.text}`);
  }
  process.exitCode = 1;
} else {
  console.log("ok: SignalOps claims honesty");
}
