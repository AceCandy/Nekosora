#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const QUALITY_SCRIPTS = ["lint", "typecheck", "test", "build"];

export const WORKSPACE_QUALITY_POLICY = {
  "@nekusora/gateway": { qualityScripts: QUALITY_SCRIPTS },
  "@nekusora/web": { qualityScripts: QUALITY_SCRIPTS },
  "@nekusora/worker": { qualityScripts: QUALITY_SCRIPTS },
  "@nekusora/core": { qualityScripts: ["lint", "typecheck", "test"] },
  "@nekusora/queue": { qualityScripts: ["lint", "typecheck", "test"] },
  "@nekusora/contracts": {
    qualityScripts: ["typecheck"],
    exception: "Shared TypeScript contracts currently contain no runtime logic to test.",
  },
  "@nekusora/db": {
    qualityScripts: ["typecheck"],
    exception: "Database behavior is exercised through its consuming application suites.",
  },
  "@nekusora/observability": {
    qualityScripts: ["typecheck"],
    exception: "The package is a thin metrics adapter with no standalone behavior today.",
  },
};

export function validateWorkspacePackages(packages, policy = WORKSPACE_QUALITY_POLICY) {
  const errors = [];
  const packagesByName = new Map(packages.map((workspace) => [workspace.name, workspace]));

  for (const workspace of packages) {
    const rules = policy[workspace.name];
    if (!rules) {
      errors.push(`unregistered workspace: ${workspace.name}`);
      continue;
    }

    for (const script of rules.qualityScripts) {
      if (!workspace.scripts?.[script]) {
        errors.push(`${workspace.name} is missing quality script: ${script}`);
      }
    }

    for (const script of QUALITY_SCRIPTS) {
      if (workspace.scripts?.[script] && !rules.qualityScripts.includes(script)) {
        errors.push(`${workspace.name} has undeclared quality script: ${script}`);
      }
    }

    if (rules.exception && !rules.exception.trim()) {
      errors.push(`${workspace.name} has an empty quality exception`);
    }
  }

  for (const name of Object.keys(policy)) {
    if (!packagesByName.has(name)) errors.push(`quality policy references missing workspace: ${name}`);
  }

  return errors;
}

function loadWorkspacePackages(root) {
  const listed = spawnSync(
    "pnpm",
    ["list", "--recursive", "--depth", "-1", "--json"],
    { cwd: root, encoding: "utf8" },
  );
  if (listed.status !== 0) {
    throw new Error(listed.stderr.trim() || "pnpm workspace listing failed");
  }

  const entries = JSON.parse(listed.stdout);
  return entries
    .filter((entry) => resolve(entry.path) !== root)
    .map((entry) => JSON.parse(readFileSync(resolve(entry.path, "package.json"), "utf8")));
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const errors = validateWorkspacePackages(loadWorkspacePackages(root));
  if (errors.length > 0) {
    for (const error of errors) console.error(`workspace quality: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("workspace quality: 8 workspaces match policy");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
