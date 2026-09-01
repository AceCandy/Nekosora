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

function assertPostgresGate(job) {
  const service = job.services.postgres;
  assert.equal(service.image, "pgvector/pgvector:pg17");
  assert.deepEqual(service.ports, ["5432:5432"]);
  assert.match(service.options, /pg_isready/);

  const unitTest = job.steps.findIndex((step) => step.run === "pnpm test");
  const postgresTest = job.steps.findIndex((step) => step.run === "pnpm test:pg");
  assert.ok(unitTest >= 0 && postgresTest > unitTest);
  assert.match(job.steps[postgresTest].env.DATABASE_URL, /^postgresql:\/\/[^@]+@127\.0\.0\.1:5432\/postgres$/);
}

test("PR and main quality workflow gates the unified amd64 image", () => {
  const source = read(".github/workflows/quality.yml");
  const workflow = parse(source);

  assert.ok(Object.hasOwn(workflow.on, "pull_request"));
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.jobs.docker.needs, "quality");
  assert.equal(workflow.jobs.docker["timeout-minutes"], 30);
  assert.equal(workflow.jobs.docker.strategy, undefined);

  const build = workflow.jobs.docker.steps.find((step) => step.id === "build");
  assert.equal(build.with.file, "Dockerfile");
  assert.equal(build.with.platforms, "linux/amd64");
  assert.equal(build.with.pull, true);
  assert.equal(build.with.push, false);
  assert.equal(build.with.tags, "local/nekusora:ci");
  assert.match(build.with["cache-from"], /scope=quality-nekusora/);

  const qualityCommands = workflow.jobs.quality.steps.map((step) => step.run ?? "").join("\n");
  for (const command of [
    "pnpm install --frozen-lockfile",
    "pnpm lint:workflows",
    "docker compose -f docker-compose.yml config --quiet",
    "docker compose --env-file deploy/production.env.example -f compose.production.yml config --quiet",
    "pnpm quality:workspace",
    "pnpm check",
    "pnpm test",
    "pnpm test:pg",
    "pnpm build",
    "pnpm build:gateway",
    "pnpm build:worker",
  ]) assert.match(qualityCommands, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assertPostgresGate(workflow.jobs.quality);
  assertActionsPinned(source);
});

test("publish workflow builds one image on native runners and isolates DockerHub sync", () => {
  const source = read(".github/workflows/docker-publish.yml");
  const workflow = parse(source);
  const ghcrBuild = workflow.jobs.ghcr_build;
  const ghcr = workflow.jobs.ghcr_publish;
  const dockerhub = workflow.jobs.dockerhub_sync;
  const qualityCommands = workflow.jobs.quality.steps.map((step) => step.run ?? "").join("\n");

  assert.match(qualityCommands, /pnpm quality:workspace/);
  assert.match(qualityCommands, /docker compose -f docker-compose\.yml config --quiet/);
  assert.match(qualityCommands, /docker compose --env-file deploy\/production\.env\.example -f compose\.production\.yml config --quiet/);
  assertPostgresGate(workflow.jobs.quality);

  assert.equal(ghcrBuild.needs, "quality");
  assert.deepEqual(ghcr.needs, ["quality", "ghcr_build"]);
  assert.equal(dockerhub.needs, "ghcr_publish");
  assert.doesNotMatch(dockerhub.if, /always\s*\(/);
  assert.match(dockerhub.if, /github\.event_name\s*==\s*'push'/);
  assert.match(dockerhub.if, /github\.ref_type\s*==\s*'tag'/);
  assert.match(dockerhub.if, /startsWith\(github\.ref_name,\s*'v'\)/);

  assert.deepEqual(ghcrBuild.strategy.matrix.include, [
    { platform: "linux/amd64", runner: "ubuntu-latest", arch: "amd64" },
    { platform: "linux/arm64", runner: "ubuntu-24.04-arm", arch: "arm64" },
  ]);
  assert.equal(ghcrBuild["runs-on"], "${{ matrix.runner }}");
  assert.equal(ghcrBuild["timeout-minutes"], 30);
  assert.equal(ghcrBuild.steps.some((step) => String(step.uses ?? "").startsWith("docker/setup-qemu-action@")), false);
  const platformBuild = ghcrBuild.steps.find((step) => step.id === "push");
  assert.equal(platformBuild.with.file, "Dockerfile");
  assert.equal(platformBuild.with.platforms, "${{ matrix.platform }}");
  assert.equal(platformBuild.with.pull, true);
  assert.match(platformBuild.with.outputs, /push-by-digest=true/);
  assert.equal(ghcr["timeout-minutes"], 10);
  assert.match(ghcr.steps.find((step) => step.id === "manifest").run, /imagetools create/);
  assert.match(ghcr.steps.find((step) => step.id === "manifest").run, /expected two platform digests/);
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
  assert.equal(dockerhub.strategy, undefined);
  const dockerhubCopy = dockerhub.steps.find((step) => step.id === "push");
  assert.match(dockerhubCopy.run, /imagetools create/);
  assert.match(dockerhubCopy.run, /needs\.ghcr_publish\.outputs\.digest/);

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
  assert.match(publishSummaryRun, /DockerHub: see image summary/);

  for (const condition of collectValues(workflow, "if")) {
    assert.doesNotMatch(String(condition), /secrets\./, "if expressions must not read secrets directly");
  }

  assert.doesNotMatch(source, /ghcr\.io\/\$\{\{ github\.repository \}\}/);
  assert.doesNotMatch(source, /nekusora-(?:web|gateway|worker)/);
  assert.match(source, /ghcr\.io\/\$\{owner\}\/nekusora/);
  assertActionsPinned(source);
});

test("production compose runs three containers from one image", () => {
  const dockerfile = read("Dockerfile");
  const rootManifest = JSON.parse(read("package.json"));
  const runtimeManifest = JSON.parse(read("deploy/runtime/package.json"));
  const runtimeLock = read("deploy/runtime/pnpm-lock.yaml");
  const webManifest = JSON.parse(read("apps/web/package.json"));
  const compose = load("compose.production.yml");
  const services = [compose.services.web, compose.services.gateway, compose.services.worker];

  for (const artifact of [
    "/app/apps/web/.next/standalone /app",
    "/runtime /app/runtime",
  ]) assert.match(dockerfile, new RegExp(artifact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(dockerfile, /pnpm --dir deploy\/runtime fetch --prod --frozen-lockfile --ignore-workspace/);
  assert.match(dockerfile, /pnpm install --prod --offline --frozen-lockfile/);
  assert.match(dockerfile, /cp -R \/app\/apps\/gateway\/dist \/runtime\/apps\/gateway\//);
  assert.match(dockerfile, /cp -R \/app\/apps\/worker\/dist \/runtime\/apps\/worker\//);
  assert.match(dockerfile, /node --check \/runtime\/apps\/gateway\/dist\/main\.js/);
  assert.match(dockerfile, /node --check \/runtime\/apps\/worker\/dist\/main\.js/);
  assert.match(dockerfile, /cd \/runtime\/apps\/gateway && node -e "import\('mem0ai\/oss'\)"/);
  assert.match(dockerfile, /cd \/runtime\/apps\/worker && node -e "import\('mem0ai\/oss'\)"/);
  assert.match(dockerfile, /Expected one Next mem0 external alias/);
  assert.match(dockerfile, /import\(names\[0\] \+ '\/oss'\)/);
  assert.doesNotMatch(dockerfile, /pnpm .* deploy /);

  assert.equal(runtimeManifest.dependencies["mem0ai"], "3.1.6");
  assert.equal(runtimeManifest.dependencies["better-sqlite3"], "12.11.1");
  assert.equal(webManifest.dependencies["better-sqlite3"], "12.11.1");
  assert.ok(rootManifest.pnpm.onlyBuiltDependencies.includes("better-sqlite3"));
  assert.match(read("deploy/runtime/.npmrc"), /^auto-install-peers=false\s*$/);
  assert.doesNotMatch(runtimeLock, /^  (?:next|vitest|vite|pdfjs-dist|esbuild|['"]?@next\/swc)[@:]/m);

  assert.deepEqual(services.map((service) => service.image), [
    "nekusora:${IMAGE_TAG:-local}",
    "nekusora:${IMAGE_TAG:-local}",
    "nekusora:${IMAGE_TAG:-local}",
  ]);
  assert.equal(compose.services.web.build.dockerfile, "Dockerfile");
  assert.equal(compose.services.gateway.build, undefined);
  assert.equal(compose.services.worker.build, undefined);
  assert.deepEqual(compose.services.gateway.command, ["node", "dist/main.js"]);
  assert.deepEqual(compose.services.worker.command, ["node", "dist/main.js"]);
  assert.equal(compose.services.gateway.working_dir, "/app/runtime/apps/gateway");
  assert.equal(compose.services.worker.working_dir, "/app/runtime/apps/worker");
});

test("Dependabot updates pinned GitHub Actions weekly", () => {
  const config = load(".github/dependabot.yml");
  const actions = config.updates.find((entry) => entry["package-ecosystem"] === "github-actions");
  assert.equal(actions.directory, "/");
  assert.equal(actions.schedule.interval, "weekly");
});

test("production environment stays out of Git and Docker build context", () => {
  assert.match(read(".gitignore"), /^\/deploy\/production\.env$/m);
  assert.match(read(".dockerignore"), /^deploy\/production\.env$/m);
});
