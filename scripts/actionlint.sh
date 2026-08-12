#!/bin/sh
set -eu

ACTIONLINT_VERSION=1.7.12
ACTIONLINT_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
archive="actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM

curl --fail --location --silent --show-error \
  -o "$temp_dir/$archive" \
  "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/$archive"
printf '%s  %s\n' "$ACTIONLINT_SHA256" "$temp_dir/$archive" | sha256sum --check --status
tar -xzf "$temp_dir/$archive" -C "$temp_dir" actionlint
"$temp_dir/actionlint" "$@"
