import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = resolve("scripts/actionlint.sh");

async function writeExecutable(path, source) {
  await writeFile(path, source, "utf8");
  await chmod(path, 0o755);
}

async function runScript({
  os = "Linux",
  arch = "x86_64",
  checksumTool = "sha256sum",
  checksumStatus = 0,
  curlStatus = 0,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "nekusora-actionlint-test-"));
  const bin = join(directory, "bin");
  const actionlintTemp = join(directory, "actionlint-temp");
  const curlTrace = join(directory, "curl-trace");
  const hashArgsTrace = join(directory, "hash-args-trace");
  const hashInputTrace = join(directory, "hash-input-trace");
  const tarTrace = join(directory, "tar-trace");
  await mkdir(bin);
  await mkdir(actionlintTemp);

  await Promise.all([
    writeExecutable(join(bin, "uname"), `#!/bin/sh
case "$1" in
  -s) printf '%s\\n' "$MOCK_UNAME_S" ;;
  -m) printf '%s\\n' "$MOCK_UNAME_M" ;;
  *) exit 1 ;;
esac
`),
    writeExecutable(join(bin, "mktemp"), `#!/bin/sh
printf '%s\\n' "$MOCK_ACTIONLINT_TEMP_DIR"
`),
    writeExecutable(join(bin, "rm"), "#!/bin/sh\nexit 0\n"),
    writeExecutable(join(bin, "curl"), `#!/bin/sh
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) shift; output=$1 ;;
    http*) url=$1 ;;
  esac
  shift
done
printf '%s\\n' "$url" > "$MOCK_CURL_TRACE"
[ "$MOCK_CURL_STATUS" -eq 0 ] || exit "$MOCK_CURL_STATUS"
: > "$output"
`),
    writeExecutable(join(bin, "tar"), `#!/bin/sh
printf '%s\\n' "$*" > "$MOCK_TAR_TRACE"
`),
    writeExecutable(join(actionlintTemp, "actionlint"), "#!/bin/sh\nexit 0\n"),
  ]);

  if (checksumTool) {
    await writeExecutable(join(bin, checksumTool), `#!/bin/sh
IFS= read -r line || true
printf '%s\\n' "$*" > "$MOCK_HASH_ARGS_TRACE"
printf '%s\\n' "$line" > "$MOCK_HASH_INPUT_TRACE"
exit "$MOCK_CHECKSUM_STATUS"
`);
  }

  const env = {
    ...process.env,
    PATH: bin,
    MOCK_UNAME_S: os,
    MOCK_UNAME_M: arch,
    MOCK_ACTIONLINT_TEMP_DIR: actionlintTemp,
    MOCK_CURL_TRACE: curlTrace,
    MOCK_CURL_STATUS: String(curlStatus),
    MOCK_HASH_ARGS_TRACE: hashArgsTrace,
    MOCK_HASH_INPUT_TRACE: hashInputTrace,
    MOCK_CHECKSUM_STATUS: String(checksumStatus),
    MOCK_TAR_TRACE: tarTrace,
  };

  try {
    const result = spawnSync("/bin/sh", [script], { env, encoding: "utf8" });
    const optionalRead = async (path) => {
      try {
        return await readFile(path, "utf8");
      } catch {
        return "";
      }
    };
    return {
      result,
      curl: await optionalRead(curlTrace),
      hashArgs: await optionalRead(hashArgsTrace),
      hashInput: await optionalRead(hashInputTrace),
      tar: await optionalRead(tarTrace),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("pins the reviewed actionlint release and platform checksums", async () => {
  const source = await readFile(script, "utf8");
  assert.match(source, /ACTIONLINT_VERSION=1\.7\.12/);
  for (const checksum of [
    "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
    "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6",
    "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644",
    "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f",
  ]) {
    assert.match(source, new RegExp(checksum));
  }
});

test("selects the reviewed archive and checksum for each supported platform", async (t) => {
  const cases = [
    ["Linux", "x86_64", "linux_amd64", "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"],
    ["Linux", "aarch64", "linux_arm64", "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6"],
    ["Darwin", "x86_64", "darwin_amd64", "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644"],
    ["Darwin", "arm64", "darwin_arm64", "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f"],
  ];

  for (const [os, arch, platform, checksum] of cases) {
    await t.test(`${os} ${arch}`, async () => {
      const { result, curl, hashInput } = await runScript({ os, arch });
      assert.equal(result.status, 0, result.stderr);
      const archive = `actionlint_1.7.12_${platform}.tar.gz`;
      assert.match(curl, new RegExp(`/${archive}\\n$`));
      assert.match(hashInput, new RegExp(`^${checksum}  .+/${archive}\\n$`));
    });
  }
});

test("uses shasum when sha256sum is unavailable", async () => {
  const { result, hashArgs } = await runScript({ checksumTool: "shasum" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(hashArgs, "-a 256 --check\n");
});

test("fails clearly for an unsupported platform", async () => {
  const { result, curl } = await runScript({ arch: "riscv64" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported actionlint platform: Linux\/riscv64/);
  assert.equal(curl, "");
});

test("fails when the release download fails", async () => {
  const { result } = await runScript({ curlStatus: 22 });
  assert.notEqual(result.status, 0);
});

test("fails before extraction when the archive checksum is invalid", async () => {
  const { result, tar } = await runScript({ checksumStatus: 1 });
  assert.notEqual(result.status, 0);
  assert.equal(tar, "");
});

test("fails clearly when no checksum tool is available", async () => {
  const { result, tar } = await runScript({ checksumTool: "" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sha256sum or shasum is required/);
  assert.equal(tar, "");
});
