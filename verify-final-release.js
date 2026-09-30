'use strict';
const fs=require('node:fs'), crypto=require('node:crypto'), zlib=require('node:zlib'), vm=require('node:vm');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const h32=s=>crypto.createHash('sha256').update(s).digest().readUInt32BE(0);
const plan=JSON.parse(fs.readFileSync('verified-v3-final-plan.json','utf8'));
const assets=JSON.parse(fs.readFileSync('upgrade-plan.json','utf8')).assets;
if(Object.keys(assets).length!==32)throw Error('Unexpected release asset count');
for(const [p,digest] of Object.entries(assets)){
  if(!/^assets\/[A-Za-z0-9_.-]+$/.test(p)||sha(fs.readFileSync('site/'+p))!==digest)throw Error('Asset integrity mismatch');
}
const base=fs.readFileSync('site/index.html','utf8');
if(sha(base)!==plan.baseSha256)throw Error('Unexpected original release; refusing unsafe patch');
const envelope=Buffer.from(Array.from({length:plan.partCount},(_,i)=>fs.readFileSync('verified-v3-final-'+i+'.b64','utf8')).join('').replace(/\s/g,''),'base64');
if(sha(envelope)!==plan.envelopeSha256)throw Error('Encrypted release transfer integrity mismatch');
const key=Buffer.from(process.env.SR_FINAL_V3_KEY_B64||'','base64');
if(key.length!==32)throw Error('Final release key unavailable');
const decipher=crypto.createDecipheriv('aes-256-gcm',key,envelope.subarray(0,12));
decipher.setAuthTag(envelope.subarray(12,28));
const compressed=Buffer.concat([decipher.update(envelope.subarray(28)),decipher.final()]);
const patch=JSON.parse(zlib.brotliDecompressSync(compressed,{maxOutputLength:1000000}).toString('utf8'));
const lines=base.match(/[^\n]*\n|[^\n]+$/g)||[],dict=new Map(),ambiguous=new Set();
for(let i=0;i<lines.length;i++){
  const text=lines.slice(i,i+plan.chunkLines).join(''),hash=h32(text);
  if(dict.has(hash)&&dict.get(hash)!==text)ambiguous.add(hash);
  dict.set(hash,text);
}
for(const hash of ambiguous)dict.delete(hash);
const hashes=Buffer.from(plan.hashesB64,'base64');
if(hashes.length!==plan.chunkCount*4)throw Error('Invalid release plan');
const output=[],missing=[];
for(let i=0;i<plan.chunkCount;i++){
  const expected=hashes.readUInt32BE(i*4);
  const text=Object.hasOwn(patch,String(i))?patch[String(i)]:dict.get(expected);
  if(typeof text!=='string'){missing.push(i);continue;}
  if(h32(text)!==expected)throw Error('Block verification failed at '+i);
  output.push(text);
}
if(missing.length)throw Error('Base blocks missing: '+JSON.stringify(missing));
const html=output.join('');
if(sha(html)!==plan.indexSha256)throw Error('Final release SHA256 mismatch');
if(!html.includes('<div class="ver">v3.0</div>'))throw Error('Unexpected displayed version');
if(/https:\/\/fonts\.(googleapis|gstatic)\.com|navigator\.serviceWorker\.register/.test(html))throw Error('Unexpected external or persistent-cache dependency');
for(const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
fs.writeFileSync('site/index.html.tmp',html);
fs.renameSync('site/index.html.tmp','site/index.html');
console.log('FINAL_V3_VERIFIED '+JSON.stringify({version:plan.version,indexSha256:sha(html),assetsVerified:Object.keys(assets).length,syntax:'passed'}));
