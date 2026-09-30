'use strict';
const fs=require('fs'),crypto=require('crypto'),zlib=require('zlib'),path=require('path');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function split(b){const out=[];let s=0,h=0;for(let i=0;i<b.length;i++){h=((h<<1)+Math.imul(b[i]+1,0x9e3779b1))>>>0;const n=i+1-s;if(n>=256&&((h&1023)===0||n>=4096)){out.push(b.subarray(s,i+1));s=i+1;h=0;}}if(s<b.length)out.push(b.subarray(s));return out;}
const plan=JSON.parse(fs.readFileSync('upgrade-plan.json','utf8'));
const old=fs.readFileSync('site/index.html'),dict=new Map();
for(const b of split(old)){const id=sha(b).slice(0,16);if(dict.has(id)&&!dict.get(id).equals(b))throw Error('Base chunk collision');dict.set(id,b);}
const missing=plan.chunks.filter(id=>!dict.has(id));
const badAssets=Object.entries(plan.assets).filter(([name,hash])=>!fs.existsSync(path.join('site',name))||sha(fs.readFileSync(path.join('site',name)))!==hash).map(([name])=>name);
console.log('V3_AUDIT '+JSON.stringify({baseSha256:sha(old),missing,badAssets}));
if(badAssets.length)throw Error('Asset integrity mismatch; live service is unchanged');
if(!fs.existsSync('upgrade-v3/000.b64'))throw Error('V3 payload required; audit only, live service is unchanged');
const names=fs.readdirSync('upgrade-v3').filter(n=>/^\d{3}\.b64$/.test(n)).sort();
const enc=Buffer.from(names.map(n=>fs.readFileSync(path.join('upgrade-v3',n),'utf8')).join('').replace(/\s/g,''),'base64');
if(sha(enc)!==process.env.SRV3_CIPHER_SHA256)throw Error('V3 ciphertext integrity mismatch');
const key=Buffer.from(process.env.SRV3_KEY_B64||'','base64'),iv=Buffer.from(process.env.SRV3_IV_B64||'','base64'),tag=Buffer.from(process.env.SRV3_TAG_B64||'','base64');
if(key.length!==32||iv.length!==12||tag.length!==16)throw Error('V3 decryption settings missing');
const d=crypto.createDecipheriv('aes-256-gcm',key,iv);d.setAuthTag(tag);
const compressed=Buffer.concat([d.update(enc),d.final()]);
const plain=(compressed[0]===31&&compressed[1]===139?zlib.gunzipSync:zlib.brotliDecompressSync)(compressed,{maxOutputLength:10000000});
if(plain.subarray(0,4).toString()!=='V3CH')throw Error('Invalid V3 payload');
let offset=4;while(offset<plain.length){if(offset+12>plain.length)throw Error('Truncated V3 record');const id=plain.subarray(offset,offset+8).toString('hex'),n=plain.readUInt32BE(offset+8);offset+=12;if(offset+n>plain.length)throw Error('Truncated V3 chunk');const b=plain.subarray(offset,offset+n);offset+=n;if(sha(b).slice(0,16)!==id)throw Error('V3 chunk integrity mismatch');if(dict.has(id)&&!dict.get(id).equals(b))throw Error('V3 chunk collision');dict.set(id,b);}
const pieces=plan.chunks.map(id=>{if(!dict.has(id))throw Error('V3 chunk missing: '+id);return dict.get(id);});
const index=Buffer.concat(pieces);
if(sha(index)!==plan.indexSha256)throw Error('V3 index integrity mismatch');
fs.writeFileSync('site/index.html.tmp',index);fs.renameSync('site/index.html.tmp','site/index.html');
console.log('V3_VERIFIED '+JSON.stringify({version:plan.version,indexSha256:sha(index),assetsVerified:Object.keys(plan.assets).length}));
