#!/bin/sh
set -eu

ACTIONLINT_VERSION=1.7.12
platform="$(uname -s)/$(uname -m)"
case "$platform" in
  Linux/x86_64)
    target=linux_amd64
    checksum=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
    ;;
  Linux/aarch64|Linux/arm64)
    target=linux_arm64
    checksum=325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6
    ;;
  Darwin/x86_64)
    target=darwin_amd64
    checksum=5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644
    ;;
  Darwin/arm64)
    target=darwin_arm64
    checksum=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f
    ;;
  *)
    printf 'Unsupported actionlint platform: %s\n' "$platform" >&2
    exit 1
    ;;
esac

if command -v sha256sum >/dev/null 2>&1; then
  checksum_tool=sha256sum
elif command -v shasum >/dev/null 2>&1; then
  checksum_tool=shasum
else
  printf 'sha256sum or shasum is required to verify actionlint\n' >&2
  exit 1
fi

archive="actionlint_${ACTIONLINT_VERSION}_${target}.tar.gz"
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM

curl --fail --location --silent --show-error \
  -o "$temp_dir/$archive" \
  "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/$archive"
if [ "$checksum_tool" = sha256sum ]; then
  printf '%s  %s\n' "$checksum" "$temp_dir/$archive" | sha256sum --check --status
else
  printf '%s  %s\n' "$checksum" "$temp_dir/$archive" | shasum -a 256 --check >/dev/null
fi
tar -xzf "$temp_dir/$archive" -C "$temp_dir" actionlint
"$temp_dir/actionlint" "$@"
