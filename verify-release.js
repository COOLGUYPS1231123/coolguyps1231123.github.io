'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const {spawn} = require('child_process');
const plan = JSON.parse(fs.readFileSync('release-v3-plan.json', 'utf8'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const token = crypto.randomBytes(32).toString('base64url');
const origin = 'http://127.0.0.1:43197';
const prefix = '/play/' + token + '/';
const child = spawn(process.execPath, ['server.js'], {env: {PORT:'43197', PLAY_TOKEN:token}, stdio:'ignore'});
(async () => {
  try {
    let ready = false;
    for (let i=0; i<80; i++) {
      try { await fetch(origin + '/', {signal:AbortSignal.timeout(500)}); ready=true; break; }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert(ready, 'Server startup failed');
    const page = await fetch(origin + prefix);
    assert.equal(page.status, 200);
    assert.equal(sha(Buffer.from(await page.arrayBuffer())), plan.indexSha256);
    assert.match(page.headers.get('cache-control'), /no-store/);
    assert.match(page.headers.get('x-robots-tag'), /noindex/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.match(page.headers.get('content-security-policy'), /connect-src 'none'/);
    for (const url of ['/', '/index.html', '/assets/run.webp', '/server.js', '/.env', '/play/invalid/', prefix+'server.js', prefix+'../server.js']) {
      assert.equal((await fetch(origin+url)).status, 404, 'Unauthorized route must be blocked');
    }
    assert.equal((await fetch(origin+prefix,{method:'POST'})).status,405);
    for (const [name, expected] of Object.entries(plan.assets)) {
      const response = await fetch(origin+prefix+name);
      assert.equal(response.status,200);
      assert.equal(sha(Buffer.from(await response.arrayBuffer())),expected,'Asset HTTP integrity mismatch');
    }
    console.log('V3_HTTP_VERIFIED ' + JSON.stringify({version:plan.version,indexSha256:plan.indexSha256,assets:32,blockedRoutes:8,postBlocked:true,noStore:true,noIndex:true,noReferrer:true}));
  } finally { child.kill('SIGTERM'); }
})().catch(error => { console.error('Release HTTP verification failed:', error.message); process.exitCode=1; });
