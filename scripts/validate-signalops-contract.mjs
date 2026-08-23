#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function jsonFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return jsonFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".json") ? [entryPath] : [];
    })
    .sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function displayPath(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  return relative.startsWith("..") ? filePath : relative;
}

const schemaPath = path.resolve(
  readArg(
    "schema",
    path.join(repositoryRoot, "schemas/ai-telemetry/v1/event.schema.json"),
  ),
);
const semanticsPath = path.resolve(
  readArg(
    "semantics",
    path.join(repositoryRoot, "schemas/ai-telemetry/v1/semantic-validation.mjs"),
  ),
);
const validDirectory = path.resolve(
  readArg(
    "valid-dir",
    path.join(repositoryRoot, "schemas/ai-telemetry/v1/fixtures/valid"),
  ),
);
const invalidDirectory = path.resolve(
  readArg(
    "invalid-dir",
    path.join(repositoryRoot, "schemas/ai-telemetry/v1/fixtures/invalid"),
  ),
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(readJson(schemaPath));
const { validateSignalOpsEventSemanticsV1 } = await import(pathToFileURL(semanticsPath).href);

const failures = [];
const validFiles = jsonFiles(validDirectory);
const invalidFiles = jsonFiles(invalidDirectory);

for (const filePath of validFiles) {
  const input = readJson(filePath);
  const schemaAccepted = validate(input);
  const semanticIssues = validateSignalOpsEventSemanticsV1(input);
  const accepted = schemaAccepted && semanticIssues.length === 0;
  if (!accepted) {
    const details = schemaAccepted
      ? semanticIssues.map((issue) => `${issue.instancePath} ${issue.message}`).join("; ")
      : ajv.errorsText(validate.errors, { separator: "; " });
    failures.push(
      `${displayPath(filePath)} should be valid: ${details}`,
    );
  }
}

for (const filePath of invalidFiles) {
  const input = readJson(filePath);
  const schemaAccepted = validate(input);
  const semanticIssues = validateSignalOpsEventSemanticsV1(input);
  const accepted = schemaAccepted && semanticIssues.length === 0;
  if (accepted) {
    failures.push(`${displayPath(filePath)} should be invalid but was accepted`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[contract:v1] ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `[contract:v1] schema=${displayPath(schemaPath)} semantics=${displayPath(semanticsPath)} valid=${validFiles.length} invalid=${invalidFiles.length}`,
  );
}
