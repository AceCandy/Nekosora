import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = resolve("scripts/actionlint.sh");

async function withMockCurl(source, run) {
  const directory = await mkdtemp(join(tmpdir(), "nekusora-actionlint-test-"));
  const curl = join(directory, "curl");
  await writeFile(curl, source, "utf8");
  await chmod(curl, 0o755);
  try {
    return run(`${directory}:${process.env.PATH}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("pins the reviewed actionlint release and checksum", async () => {
  const source = await readFile(script, "utf8");
  assert.match(source, /ACTIONLINT_VERSION=1\.7\.12/);
  assert.match(source, /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/);
});

test("fails when the release download fails", async () => {
  const result = await withMockCurl("#!/bin/sh\nexit 22\n", (path) => (
    spawnSync("sh", [script], { env: { ...process.env, PATH: path }, encoding: "utf8" })
  ));
  assert.notEqual(result.status, 0);
});

test("fails before extraction when the archive checksum is invalid", async () => {
  const mock = `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    printf 'invalid archive' > "$2"
    exit 0
  fi
  shift
done
exit 2
`;
  const result = await withMockCurl(mock, (path) => (
    spawnSync("sh", [script], { env: { ...process.env, PATH: path }, encoding: "utf8" })
  ));
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /tar:/);
});
