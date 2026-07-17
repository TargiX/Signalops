import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const homeSourcePath = path.join(repoRoot, "src/components/product-home.tsx");
const validatePagePath = path.join(repoRoot, "src/app/validate/page.tsx");

const homeSource = await readFile(homeSourcePath, "utf8");

const validateHrefPattern =
  /<Link\b[^>]*\bhref=\{?\s*["']\/validate["']\s*\}?[^>]*>/;

assert.match(
  homeSource,
  validateHrefPattern,
  "Expected homepage to contain a static /validate Link href.",
);

await access(validatePagePath);

console.log("Home navigation contract OK: homepage links to /validate and page exists.");
