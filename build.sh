#!/usr/bin/env bash
set -euo pipefail
rm -rf site site.enc site.tgz
mkdir -p site
cat archive/*.b64 | tr -d '\n\r\t ' | base64 -d > site.enc
node decrypt.js
tar -xzf site.tgz -C site
rm -f site.enc site.tgz
test -f site/index.html
# Apply exactly one authenticated update; never apply two deltas to different bases.
if [[ -n "${V3_PATCH_KEY_B64:-}" ]]; then
  node prepare-release.js
elif [[ -n "${SRV3_KEY_B64:-}" ]]; then
  node upgrade-v3.js
else
  node prepare-release.js
fi
node verify-deployment-state.js
