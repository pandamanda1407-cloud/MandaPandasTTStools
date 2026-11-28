import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {TikTokLiveConnection,WebcastEvent,ControlEvent} from 'tiktok-live-connector';
import {normalize} from './live.mjs';
const site=new URL(process.env.TREE_SITE).origin,secret=process.env.TREE_RELAY_SECRET;
if(!secret)throw new Error('Missing relay configuration');
const overlayPage="<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"referrer\" content=\"no-referrer\"><title>Vintage Twinkle · Stream overlay</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}vintage-tree{display:block;width:100%;height:100%}vintage-tree[hidden]{display:none}</style><vintage-tree hidden role=\"img\" aria-label=\"Christmas gift goal tree\"></vintage-tree><script type=\"module\" src=\"/tree.js\"></script><script>\nconst token=location.hash.slice(1),tree=document.querySelector('vintage-tree');let last=0;\nasync function refresh(){try{\n const r=await fetch('/api/view',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(9000)});\n if(r.status===404||r.status===403){last=0;tree.hidden=true;return}if(!r.ok)throw Error();\n const s=await r.json();if(!s.goal)throw Error();if(s.showCounter&&s.counterText)tree.setAttribute('counter-text',s.counterText);else tree.removeAttribute('counter-text');tree.setAttribute('tree-style',s.treeStyle||'vintage');tree.setAttribute('led-mode',s.ledMode||'rainbow');tree.setAttribute('led-color',s.ledColor||'#ab70ff');tree.setAttribute('sections',s.sections);tree.setAttribute('step',Math.min(s.sections,Math.floor(s.count*s.sections/s.goal)));tree.hidden=false;last=Date.now()\n}catch{if(Date.now()-last>120000)tree.hidden=true}finally{setTimeout(refresh,2500)}}\nif(/^[a-f0-9]{32}$/.test(token))refresh();\n</script></html>\n";
const feeds=new Map();
let storageReady=false;
async function call(payload){
 const response=await fetch(site+'/api/relay',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify(payload),signal:AbortSignal.timeout(8500)});
 if(!response.ok)throw new Error('Storage temporarily unavailable');
 return response.json();
}
function listen(row){
 let socket,retry,timer,attempt=0,stopped=false,sending=false,status='Connecting',lastStatus='',heartbeat=0;
 const queue=[];
 function later(fn,delay){return setTimeout(fn,delay)}
 async function flush(){
  if(sending||!queue.length||stopped)return;
  sending=true;const events=queue.slice(0,50);
  try{await call({action:'gifts',session:row.session,events});queue.splice(0,events.length)}catch{}finally{sending=false}
 }
 function join(){
  if(stopped)return;
  const conn=new TikTokLiveConnection(row.handle,{processInitialData:false,enableExtendedGiftInfo:false});
  socket=conn;let closed=false;
  const close=()=>{try{Promise.resolve(conn.disconnect()).catch(()=>{})}catch{}};
  const retryOn=message=>{
   if(closed||stopped)return;closed=true;status=message;close();
   retry=later(join,Math.min(90000,5000*(2**Math.min(attempt++,5))));
  };
  conn.on(WebcastEvent.GIFT,data=>{
   if(stopped||closed)return;
   const e=normalize('gift',data);if(!e)return;
   const name=e.gift||data.gift?.name||data.giftDetails?.giftName||'';
   const target=row.gift.trim().toLowerCase().replace(/^#(?=\d+$)/,'');
   if(target!==String(name).trim().toLowerCase() && target!==String(e.giftId) && !(target==='rose'&&String(e.giftId)==='5655'))return;
   queue.push({event:e.eventId||randomUUID(),quantity:e.count,name,giftId:e.giftId});
   void flush();
  });
  conn.on(ControlEvent.ERROR,()=>{});
  conn.on(ControlEvent.DISCONNECTED,()=>retryOn('Disconnected · retrying'));
  conn.on(WebcastEvent.STREAM_END,()=>{if(!stopped&&!closed){closed=true;close();status='Stream ended'}});
  conn.connect().then(()=>{if(stopped||closed)return close();attempt=0;status='Connected'}).catch(err=>{
   const reason=String(err?.name)+' '+String(err?.message);
   retryOn(/offline|not live|not found/i.test(reason)?'Channel offline · retrying':/rate|sign|quota|api.?key/i.test(reason)?'LIVE provider unavailable · retrying':'Connection unavailable · retrying');
  });
 }
 timer=setInterval(async()=>{
  await flush();if(stopped || (status==='Stream ended'&&queue.length))return;
  if(status!==lastStatus||Date.now()-heartbeat>25000){
   const sent=status;try{await call({action:'status',session:row.session,status:sent});lastStatus=sent;heartbeat=Date.now()}catch{}
  }
 },1700);
 join();
 return {stop(){stopped=true;clearTimeout(retry);clearInterval(timer);try{Promise.resolve(socket?.disconnect()).catch(()=>{})}catch{}}};
}
let syncing=false;
async function sync(){
 if(syncing)return;syncing=true;
 try{const rows=await call({action:'list'});storageReady=true;const active=new Set(rows.map(r=>r.session));
  for(const [id,feed] of feeds)if(!active.has(id)){feed.stop();feeds.delete(id)}
  for(const row of rows)if(!feeds.has(row.session))feeds.set(row.session,listen(row));
 }catch{storageReady=false}finally{syncing=false}
}
const allowed=new Map([['/tree.js','/tree.js'],['/tree/on.webp','/tree/on.webp'],['/tree/off.webp','/tree/off.webp'],['/api/view','/api/view']]);
for(const style of ['storybook','pine','spruce']){
 for(const state of ['off','on']){
  const path='/tree/'+style+'-'+state+'.webp';allowed.set(path,path);
 }
}
http.createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/overlay'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','Referrer-Policy':'no-referrer'});return res.end(overlayPage)}
  if(path==='/ready'){res.writeHead(storageReady?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({ready:storageReady}))}
  if(path==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end('{"ok":true}')}
  if(path==='/wake'&&req.method==='POST'&&req.headers.authorization==='Bearer '+secret){void sync();res.writeHead(202);return res.end()}
  if(path==='/'){res.writeHead(302,{Location:site+'/'});return res.end()}
  if(req.method!=='GET'||!allowed.has(path)){res.writeHead(404);return res.end()}
  if(path==='/api/view'&&!/^Bearer [a-f0-9]{32}$/.test(req.headers.authorization||'')){res.writeHead(404);return res.end()}
  const target=allowed.get(path);
  const upstream=await fetch(site+target,{headers:path==='/api/view'?{Authorization:req.headers.authorization}:{},redirect:'manual',signal:AbortSignal.timeout(12000)});
  const cache=path==='/api/view'?'no-store':(path.startsWith('/tree/')?'public,max-age=86400':'no-cache');
  res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'text/plain','Cache-Control':cache,'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
  res.end(Buffer.from(await upstream.arrayBuffer()));
 }catch{res.writeHead(503);res.end('Waking up. Please retry.')}
}).listen(Number(process.env.PORT||10000),'0.0.0.0',()=>{console.log('Vintage Twinkle relay ready');void sync()});
setInterval(sync,12000);
