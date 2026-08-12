import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const read = (path) => readFileSync(path, "utf8");
const load = (path) => parse(read(path));

function collectValues(value, key, results = []) {
  if (!value || typeof value !== "object") return results;
  if (Object.hasOwn(value, key)) results.push(value[key]);
  for (const child of Object.values(value)) collectValues(child, key, results);
  return results;
}

function assertActionsPinned(source) {
  const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(uses.length > 0);
  for (const action of uses) {
    if (action.startsWith("./")) continue;
    assert.match(action, /@[0-9a-f]{40}$/i, `${action} must use a full commit SHA`);
  }
}

test("PR and main quality workflow gates all three amd64 images", () => {
  const source = read(".github/workflows/quality.yml");
  const workflow = parse(source);

  assert.ok(Object.hasOwn(workflow.on, "pull_request"));
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.jobs.docker.needs, "quality");
  assert.equal(workflow.jobs.docker.strategy["fail-fast"], false);
  assert.deepEqual(workflow.jobs.docker.strategy.matrix.include, [
    { component: "web", file: "Dockerfile", image: "nekusora-web" },
    { component: "gateway", file: "Dockerfile.gateway", image: "nekusora-gateway" },
    { component: "worker", file: "Dockerfile.worker", image: "nekusora-worker" },
  ]);

  const build = workflow.jobs.docker.steps.find((step) => step.id === "build");
  assert.equal(build.with.platforms, "linux/amd64");
  assert.equal(build.with.push, false);
  assert.match(build.with["cache-from"], /scope=quality-\$\{\{ matrix\.component \}\}/);

  const qualityCommands = workflow.jobs.quality.steps.map((step) => step.run ?? "").join("\n");
  for (const command of [
    "pnpm install --frozen-lockfile",
    "pnpm lint:workflows",
    "pnpm quality:workspace",
    "pnpm check",
    "pnpm test",
    "pnpm build",
    "pnpm build:gateway",
    "pnpm build:worker",
  ]) assert.match(qualityCommands, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assertActionsPinned(source);
});

test("publish workflow gates GHCR and isolates optional DockerHub sync", () => {
  const source = read(".github/workflows/docker-publish.yml");
  const workflow = parse(source);
  const ghcr = workflow.jobs.ghcr_publish;
  const dockerhub = workflow.jobs.dockerhub_sync;
  const qualityCommands = workflow.jobs.quality.steps.map((step) => step.run ?? "").join("\n");

  assert.match(qualityCommands, /pnpm quality:workspace/);

  assert.equal(ghcr.needs, "quality");
  assert.equal(dockerhub.needs, "ghcr_publish");
  assert.doesNotMatch(dockerhub.if, /always\s*\(/);
  assert.match(dockerhub.if, /github\.event_name\s*==\s*'push'/);
  assert.match(dockerhub.if, /github\.ref_type\s*==\s*'tag'/);
  assert.match(dockerhub.if, /startsWith\(github\.ref_name,\s*'v'\)/);

  assert.deepEqual(ghcr.strategy.matrix.include, [
    { component: "web", file: "Dockerfile", image: "nekusora-web" },
    { component: "gateway", file: "Dockerfile.gateway", image: "nekusora-gateway" },
    { component: "worker", file: "Dockerfile.worker", image: "nekusora-worker" },
  ]);
  assert.equal(ghcr.steps.find((step) => step.id === "push").with.platforms, "linux/amd64,linux/arm64");
  assert.equal(ghcr.steps.find((step) => step.id === "push").with.push, true);
  assert.equal(ghcr["continue-on-error"], undefined);

  const ghcrTags = ghcr.steps.find((step) => step.id === "meta").with.tags.trim().split("\n");
  assert.deepEqual(ghcrTags, [
    "type=semver,pattern={{version}},enable=${{ github.event_name == 'push' && github.ref_type == 'tag' }}",
    "type=semver,pattern={{major}}.{{minor}},enable=${{ github.event_name == 'push' && github.ref_type == 'tag' }}",
    "type=semver,pattern={{major}},enable=${{ github.event_name == 'push' && github.ref_type == 'tag' }}",
    "type=raw,value=latest,enable=${{ github.event_name == 'push' && github.ref_type == 'tag' }}",
    "type=edge,branch=main,enable=${{ github.ref == 'refs/heads/main' }}",
    "type=sha,format=short",
  ]);

  const dockerhubTags = dockerhub.steps.find((step) => step.id === "meta").with.tags.trim().split("\n");
  assert.deepEqual(dockerhubTags, ghcrTags.filter((tag) => !tag.startsWith("type=edge")).map((tag) => tag.replace(/,enable=.*$/, "")));

  const freshness = workflow.jobs.quality.steps.find((step) => step.id === "freshness").run;
  assert.match(freshness, /actions\/workflows\/docker-publish\.yml\/runs/);
  assert.match(freshness, /branch=main/);
  assert.match(freshness, /event=schedule/);
  assert.match(freshness, /status=success/);
  assert.match(freshness, /skip=false/);

  const dockerhubSummary = dockerhub.steps.find((step) => step.id === "summary");
  assert.match(dockerhubSummary.if, /always\s*\(/);
  assert.equal(dockerhubSummary["continue-on-error"], undefined);

  const publishSummary = workflow.jobs.publish_summary;
  assert.deepEqual(publishSummary.needs, ["quality", "ghcr_publish", "dockerhub_sync"]);
  assert.match(publishSummary.if, /always\s*\(/);
  const publishSummaryRun = publishSummary.steps.find((step) => step.run).run;
  assert.match(publishSummaryRun, /Scheduled publish: skipped/);
  assert.match(publishSummaryRun, /DockerHub: not applicable for schedule\/manual publishing/);
  assert.match(publishSummaryRun, /DockerHub: see component summaries/);

  for (const condition of collectValues(workflow, "if")) {
    assert.doesNotMatch(String(condition), /secrets\./, "if expressions must not read secrets directly");
  }

  assert.doesNotMatch(source, /ghcr\.io\/\$\{\{ github\.repository \}\}/);
  assert.doesNotMatch(source, /(?:acecandy\/|\/)(?:nekusora):/);
  assertActionsPinned(source);
});

test("Dependabot updates pinned GitHub Actions weekly", () => {
  const config = load(".github/dependabot.yml");
  const actions = config.updates.find((entry) => entry["package-ecosystem"] === "github-actions");
  assert.equal(actions.directory, "/");
  assert.equal(actions.schedule.interval, "weekly");
});
