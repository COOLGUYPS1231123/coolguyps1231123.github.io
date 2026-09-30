'use strict';
const fs = require('fs');
const crypto = require('crypto');
const vm = require('vm');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const planPath = process.env.V3_PATCH_KEY_B64 ? 'release-v3-plan.json' : process.env.SRV3_KEY_B64 ? 'upgrade-plan.json' : null;
if (!planPath) throw new Error('No authenticated v3 release selected');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync('release-v3-manifest.json', 'utf8'));
if (plan.version !== manifest.version || !/^[a-f0-9]{64}$/.test(manifest.sourceArchiveSha256)) throw new Error('Invalid release manifest');
const index = fs.readFileSync('site/index.html');
if (sha(index) !== plan.indexSha256) throw new Error('Index integrity mismatch');
const assets = Object.entries(plan.assets);
for (const [name, expected] of assets) {
  if (!/^assets\/[A-Za-z0-9_.-]+$/.test(name) || sha(fs.readFileSync('site/' + name)) !== expected) throw new Error('Asset integrity mismatch');
}
for (const match of index.toString('utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
const release = {version: plan.version, indexSha256: sha(index), sourceArchiveSha256: manifest.sourceArchiveSha256, assetCount: assets.length};
const text = JSON.stringify(release, null, 2);
fs.writeFileSync('site/release.json', text + '\n');
const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
fs.writeFileSync('site/release.html', '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Suheong Run release verification</title><h1>Suheong Run ' + release.version + '</h1><pre>' + escaped + '</pre></html>\n');
console.log('DEPLOYMENT_RELEASE_VERIFIED ' + JSON.stringify(release));
