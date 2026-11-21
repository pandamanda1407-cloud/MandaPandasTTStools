import http from 'node:http';
import { randomBytes, createHash,createHmac } from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {extname} from 'node:path';
import {idle,fresh,input,visible,defaults,clock,applyGift,guess} from './game.mjs';
import {makeFeed} from './live.mjs';
const directory=new URL('/api/directory',process.env.DIRECTORY_URL), secret=process.env.DIRECTORY_BEARER, signing=process.env.OVERLAY_SECRET;
if(!secret||!signing)throw Error('Configure the access directory and overlay key');
const rooms=new Map(),lookups=new Map(),rates=new Map();
const sha=s=>createHash('sha256').update(s).digest('hex');
const token=()=>randomBytes(32).toString('hex');
const overlayKey=k=>createHmac('sha256',signing).update('overlay/'+k).digest('hex');
const error=(status,message)=>Object.assign(new Error(message),{status});
async function db(b){
 const r=await fetch(directory,{method:'POST',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+secret,'content-type':'application/json','accept':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw error(r.status===409?409:503,'Access directory unavailable');
 return r.json();
}
async function lookup(kind,key){
 if(!/^[a-f0-9]{64}$/.test(key||''))return null;
 const hash=sha(key),cached=lookups.get(kind+hash);
 if(cached?.until>Date.now())return cached.value;
 const value=await db({op:'lookup',kind,key:hash});
 if(value)lookups.set(kind+hash,{until:Date.now()+3000,value});
 return value;
}
function begin(room,mode){
 const prev=room.data.game;const game=fresh(room.data.minutes);
 if(mode===room.data.mode){game.players=prev.players;game.counts=prev.counts;game.seen=prev.seen;}
 room.data.mode=mode;room.data.game=game;room.dirty=true;
}
function advance(room){
 const g=room.data.game;
 if(clock(g))room.dirty=true;
 if(g.phase==='ended'&&g.winner==='house'&&Date.now()>=g.ends+8000)begin(room,room.data.mode);
}
function save(room){
 if(!room.dirty||room.saving||room.closed)return;
 room.dirty=false;
 room.saving=db({op:'save',id:room.id,revision:room.revision,checkpoint:JSON.stringify(room.data)})
 .then(()=>{room.revision++;room.storeError=false;}).catch(e=>{room.dirty=true;room.storeError=true;if(e.status===409)retire(room);})
 .finally(()=>{room.saving=null;});
}
function retire(room){room.closed=true;room.feed.disconnect();rooms.delete(room.id);}
async function restore(row){
 const saved=await db({op:'load',id:row.id});if(!saved)throw error(403,'Approval required');
 const data=saved.checkpoint?JSON.parse(saved.checkpoint):{game:idle(),minutes:10,rules:{...defaults},mode:'live',listen:false};
 const room={id:row.id,handle:row.handle,data,revision:saved.revision,dirty:false,last:Date.now(),authAt:Date.now()};
 room.feed=makeFeed(row.handle,e=>{if(room.closed||Date.now()-room.authAt>15000)return;advance(room);if(room.data.mode==='live'&&input(room.data.game,e,room.data.rules))room.dirty=true;});
 if(data.listen)room.feed.start();
 return room;
}
async function roomFor(row){if(!rooms.has(row.id))rooms.set(row.id,restore(row).catch(e=>{rooms.delete(row.id);throw e;}));const room=await rooms.get(row.id);room.last=room.authAt=Date.now();advance(room);return room;}
setInterval(async()=>{
 for(const p of rooms.values()){const r=await p.catch(()=>null);if(!r||r.closed)continue;
 if(Date.now()-r.last>120000){if(!r.dirty&&!r.saving){retire(r);continue;}}else advance(r);
 save(r);}
 for(const [k,v] of lookups)if(v.until<Date.now())lookups.delete(k);
 for(const [k,v] of rates)if(v.until<Date.now())rates.delete(k);
},500).unref();
function hostView(r,key){return {access:'approved',id:r.id,handle:r.handle,board:visible(r.data.game),rules:r.data.rules,minutes:r.data.minutes,mode:r.data.mode,feed:r.feed.state,overlay:overlayKey(key),storeError:!!r.storeError};}
async function body(req){let raw='';for await(const b of req){raw+=b.toString();if(raw.length>4096)throw error(413,'Request too large');}try{return JSON.parse(raw||'{}')}catch{throw error(400,'Invalid input')}}
const staticFiles=new Set(['index.html','overlay.html','host.js','board.js','board.css','host.css','manifest.webmanifest','sw.js','icon-192.png','icon-512.png','Vault-Wars-Windows.zip',...['vault-frame','red-dial','red-keypad','red-rotor','blue-dial','blue-keypad','blue-rotor'].map(s=>'board/'+s+'.webp')]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.webmanifest':'application/manifest+json','.zip':'application/zip'};
const server=http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
 const reply=(b,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(b));};
 try{
 if(path==='/health'){return reply({ok:true});}
 if(!path.startsWith('/api/')){const f=path==='/'?'index.html':path==='/overlay'?'overlay.html':path.slice(1);if(!staticFiles.has(f))throw error(404,'Page unavailable');const bytes=await readFile(fileURLToPath(new URL('./public/'+f,import.meta.url)));res.writeHead(200,{'Content-Type':mime[extname(f)]||'application/octet-stream'});return res.end(bytes);}
 if(req.method==='POST'&&req.headers.origin && req.headers.origin!==('https://'+req.headers.host) && req.headers.origin!==('http://'+req.headers.host))throw error(403,'Invalid origin');
 if(req.method==='POST'&&!(req.headers['content-type']||'').includes('application/json'))throw error(415,'JSON required');
 const key=(req.headers.cookie||'').match(/(?:^|;\s*)vw_device=([0-9a-f]{64})(?:;|$)/)?.[1];
 if(path==='/api/request'&&req.method==='POST'){
  const existing=await lookup('device',key);if(existing&&['approved','pending'].includes(existing.status))return reply({access:existing.status,id:existing.id,handle:existing.handle});
  const b=await body(req),handle=String(b.handle||'').trim().replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9_.]{2,24}$/.test(handle))throw error(400,'Enter a valid TikTok username');
  const ip=req.headers['cf-connecting-ip']||req.headers['x-forwarded-for']?.split(',').at(-1)?.trim()||req.socket.remoteAddress;
  const rate=rates.get(ip)||{until:Date.now()+600000,n:0};if(rate.until>Date.now()&&rate.n>=8)throw error(429,'Please try again in ten minutes');rate.n++;rates.set(ip,rate);
  const k=token(),id=randomBytes(8).toString('hex');
  await db({op:'request',device:sha(k),overlay:sha(overlayKey(k)),id,handle});
  res.setHeader('Set-Cookie','vw_device='+k+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000');
  return reply({access:'pending',id,handle});
 }
 if(path==='/api/overlay'&&req.method==='GET'){
  const o=await lookup('overlay',(req.headers.authorization||'').replace(/^Bearer /,''));
  if(o?.status!=='approved')throw error(403,'Overlay access required');
  const r=await roomFor(o);return reply({...visible(r.data.game),mode:r.data.mode});
 }
 const row=await lookup('device',key);
 if(path==='/api/host'&&req.method==='GET'&&row?.status!=='approved')return reply({access:row?.status||'new',id:row?.id,handle:row?.handle});
 if(row?.status!=='approved')throw error(403,'Streamer approval required');
 const r=await roomFor(row);
 if(path==='/api/host'&&req.method==='GET')return reply(hostView(r,key));
 if(path!=='/api/control'||req.method!=='POST')throw error(404,'Command unavailable');
 const b=await body(req),g=r.data.game;
 if(b.action==='settings'){
  const mins=Number(b.minutes);if(!Number.isInteger(mins)||mins<1||mins>120)throw error(400,'Choose 1–120 minutes');
  const rules={};for(const k of Object.keys(defaults)){rules[k]=String(b.rules?.[k]??'').trim().slice(0,64);if(k!=='pending'&&!rules[k])throw error(400,'Enter a gift name or ID');}
  for(const side of ['redErase','blueErase']){const names=['clear',side,'pending','instant'].map(k=>rules[k].toLowerCase()).filter(Boolean);if(new Set(names).size!==names.length)throw error(400,'Use different gifts for each effect');}
  r.data.minutes=mins;r.data.rules=rules;
 }else if(b.action==='connect'){r.data.listen=true;r.feed.start();}
 else if(b.action==='disconnect'){r.data.listen=false;r.feed.disconnect();}
 else if(b.action==='start'){if(g.phase==='playing')throw error(409,'End the current heist first');if(!['live','practice'].includes(b.mode))throw error(400,'Choose a mode');if(b.mode==='live'&&r.feed.state.status!=='Connected')throw error(409,'Connect to your live stream first');begin(r,b.mode);}
 else if(b.action==='end'){r.data.game=idle();r.data.game.players=g.players;r.data.game.counts=g.counts;r.data.game.seen=g.seen;}
 else if(b.action==='practice'&&r.data.mode==='practice'&&g.phase==='playing'){
  if(!['red','blue'].includes(b.side))throw error(400,'Choose a crew');
  if(b.effect==='guess'){const n=Number(b.number);if(!Number.isInteger(n)||n<1||n>100)throw error(400,'Guess 1–100');guess(g,b.side,n,'Practice');}
  else if(b.effect==='solve')guess(g,b.side,g.teams[b.side].code[g.teams[b.side].solved],'Practice');
  else if(['clear','erase','pending','instant'].includes(b.effect))applyGift(g,b.side,b.effect);
  else throw error(400,'Unknown practice action');
 }else throw error(400,'Command unavailable');
 r.dirty=true;save(r);return reply(hostView(r,key));
 }catch(e){if(!e.status||e.status===503)console.warn('Request failed',path,e.status||500);reply({error:e.status?e.message:'Service temporarily unavailable'},e.status||503);}
});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Vault Wars ready'));
process.on('SIGTERM',async()=>{server.close();for(const p of rooms.values()){const r=await p.catch(()=>null);if(!r)continue;r.feed.disconnect();await r.saving;save(r);await r.saving;}process.exit(0)});
