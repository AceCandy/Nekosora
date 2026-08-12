import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkspacePackages } from "./workspace-quality.mjs";

const policy = {
  "@nekusora/app": { qualityScripts: ["lint", "typecheck", "test", "build"] },
  "@nekusora/thin": {
    qualityScripts: ["typecheck"],
    exception: "Thin schema package without runtime logic.",
  },
};

test("accepts a registered workspace with its declared quality scripts", () => {
  assert.deepEqual(validateWorkspacePackages([
    {
      name: "@nekusora/app",
      scripts: { lint: "eslint src", typecheck: "tsc", test: "vitest", build: "tsup" },
    },
    { name: "@nekusora/thin", scripts: { typecheck: "tsc" } },
  ], policy), []);
});

test("rejects an unregistered workspace", () => {
  assert.match(
    validateWorkspacePackages([
      { name: "@nekusora/app", scripts: { lint: "x", typecheck: "x", test: "x", build: "x" } },
      { name: "@nekusora/thin", scripts: { typecheck: "x" } },
      { name: "@nekusora/new-package", scripts: { typecheck: "x" } },
    ], policy).join("\n"),
    /unregistered workspace: @nekusora\/new-package/,
  );
});

test("rejects a missing required script", () => {
  assert.match(
    validateWorkspacePackages([
      { name: "@nekusora/app", scripts: { lint: "x", typecheck: "x", build: "x" } },
      { name: "@nekusora/thin", scripts: { typecheck: "x" } },
    ], policy).join("\n"),
    /@nekusora\/app is missing quality script: test/,
  );
});

test("rejects a new test script until an exception policy is reviewed", () => {
  assert.match(
    validateWorkspacePackages([
      { name: "@nekusora/app", scripts: { lint: "x", typecheck: "x", test: "x", build: "x" } },
      { name: "@nekusora/thin", scripts: { typecheck: "x", test: "vitest" } },
    ], policy).join("\n"),
    /@nekusora\/thin has undeclared quality script: test/,
  );
});
