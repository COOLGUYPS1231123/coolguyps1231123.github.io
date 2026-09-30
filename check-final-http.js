'use strict';
const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const plan=JSON.parse(fs.readFileSync('verified-v3-final-plan.json','utf8'));
const assets=JSON.parse(fs.readFileSync('upgrade-plan.json','utf8')).assets;
const token=String(process.env.PLAY_TOKEN||'').trim();
if(!/^[A-Za-z0-9_-]{32,}$/.test(token))throw Error('Private access token unavailable');
const prefix='/play/'+token,port=4011;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port)},stdio:['ignore','ignore','pipe']});
child.stderr.on('data',()=>{});
let childError=null;child.on('error',e=>{childError=e;});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function request(path,method='GET'){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path,method,timeout:5000},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({code:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('timeout',()=>req.destroy(new Error('HTTP check timed out')));req.on('error',reject);req.end();});}
(async()=>{
 try{
  let ready=false;
  for(let i=0;i<50;i++){if(childError)throw childError;try{if((await request('/')).code===404){ready=true;break;}}catch{}await wait(100);}
  if(!ready)throw Error('Server did not become ready');
  const index=await request(prefix+'/');
  if(index.code!==200||sha(index.body)!==plan.indexSha256)throw Error('Served index mismatch');
  if(!String(index.headers['cache-control']).includes('no-store')||!String(index.headers['x-robots-tag']).includes('noindex')||!String(index.headers['content-security-policy']).includes("connect-src 'none'"))throw Error('Private playtest headers missing');
  for(const p of ['/','/play/invalid/','/server.js','/.env','/assets/run.webp',prefix+'/server.js',prefix+'/.env',prefix+'/../server.js']){
   if((await request(p)).code!==404)throw Error('Unauthorized resource was not blocked');
  }
  if((await request(prefix+'/', 'POST')).code!==405)throw Error('Unexpected write method allowed');
  for(const [p,digest] of Object.entries(assets)){
   const r=await request(prefix+'/'+p);
   if(r.code!==200||sha(r.body)!==digest)throw Error('Served asset integrity mismatch');
  }
  console.log('FINAL_V3_HTTP_VERIFIED '+JSON.stringify({version:plan.version,indexSha256:sha(index.body),assets:32,privateRoutes:'passed',noStore:true,noIndex:true}));
 }catch(e){console.error('FINAL_V3_HTTP_FAILED '+e.message);process.exitCode=1;}
 finally{child.kill('SIGTERM');}
})().catch(()=>{child.kill('SIGTERM');process.exitCode=1;});
