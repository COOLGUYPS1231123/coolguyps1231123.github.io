#!/usr/bin/env bash
set -euo pipefail
rm -rf site site.enc site.tgz
mkdir -p site
cat archive/*.b64 | tr -d '\n\r\t ' | base64 -d > site.enc
node decrypt.js
tar -xzf site.tgz -C site
rm -f site.enc site.tgz
test -f site/index.html
node prepare-release.js
