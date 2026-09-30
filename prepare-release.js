'use strict';
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const path = require('path');
const plan = JSON.parse(fs.readFileSync('release-v3-plan.json', 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const digest32 = value => crypto.createHash('sha256').update(value).digest().readUInt32BE(0);
const expectedHashes = Buffer.from(plan.hashesB64, 'base64');
if (expectedHashes.length !== plan.chunkCount * 4) throw new Error('Invalid release outline');
for (const [name, expected] of Object.entries(plan.assets)) {
  if (!/^assets\/[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Invalid asset path');
  if (sha(fs.readFileSync(path.join('site', name))) !== expected) throw new Error('Asset mismatch: ' + name);
}
const base = fs.readFileSync('site/index.html', 'utf8');
const baseSha = sha(base);
const lines = base.match(/[^\n]*\n|[^\n]+$/g) || [];
const dictionary = new Map();
const ambiguous = new Set();
for (let i = 0; i <= lines.length - plan.chunkLines; i++) {
  const text = lines.slice(i, i + plan.chunkLines).join('');
  const h = digest32(text);
  if (dictionary.has(h) && dictionary.get(h) !== text) ambiguous.add(h);
  else dictionary.set(h, text);
}
for (const h of ambiguous) dictionary.delete(h);
const missing = [];
for (let i = 0; i < plan.chunkCount; i++) if (!dictionary.has(expectedHashes.readUInt32BE(i * 4))) missing.push(i);
console.log('V3_PREFLIGHT ' + JSON.stringify({baseSha, baseLines: lines.length, assetsVerified: Object.keys(plan.assets).length, missing}));
const keyText = process.env.V3_PATCH_KEY_B64;
if (keyText) {
  const key = Buffer.from(keyText, 'base64');
  if (key.length !== 32) throw new Error('Invalid release key');
  const encoded = [0, 1, 2].map(i => fs.readFileSync('release-v3-patch-' + i + '.b64', 'utf8')).join('');
  const envelope = Buffer.from(encoded.replace(/\s/g, ''), 'base64');
  if (envelope.length < 29) throw new Error('Invalid release payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, envelope.subarray(0, 12));
  decipher.setAuthTag(envelope.subarray(12, 28));
  const compressed = Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]);
  const patch = JSON.parse(zlib.brotliDecompressSync(compressed, {maxOutputLength: 2000000}).toString('utf8'));
  if (patch.baseSha !== baseSha || patch.targetSha !== plan.indexSha256) throw new Error('Release/base mismatch');
  const chunks = [];
  for (let i = 0; i < plan.chunkCount; i++) {
    const text = Object.prototype.hasOwnProperty.call(patch.chunks, i) ? patch.chunks[i] : dictionary.get(expectedHashes.readUInt32BE(i * 4));
    if (typeof text !== 'string' || digest32(text) !== expectedHashes.readUInt32BE(i * 4)) throw new Error('Missing/invalid release chunk: ' + i);
    chunks.push(text);
  }
  const result = chunks.join('');
  if (sha(result) !== plan.indexSha256) throw new Error('Final release SHA-256 mismatch');
  fs.writeFileSync('site/index.html.tmp', result);
  fs.renameSync('site/index.html.tmp', 'site/index.html');
  console.log('V3_RELEASE_VERIFIED ' + JSON.stringify({version: plan.version, files: Object.keys(plan.assets).length + 1, sha256: sha(result)}));
} else {
  console.log('V3_PREFLIGHT_ONLY: original game preserved');
}
