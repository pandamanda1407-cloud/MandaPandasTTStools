import {createBoard} from './board.js';
const $=id=>document.getElementById(id);let state={},preview,settingsLoaded=false,busy=false,noticeTimer,version=0;
function notice(s){$('message').textContent=s;$('message').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('message').hidden=true,6500);}
async function api(path,b){const r=await fetch('/api/'+path,b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}:{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to reach the heist');return data;}
function show(s){
 state=s;const ok=s.access==='approved';$('studio').hidden=!ok;$('lobby').hidden=ok;$('location').textContent=ok?'STREAMER STUDIO':'STREAMER LOBBY';
 if(!ok){const pending=s.access==='pending',other=['declined','revoked'].includes(s.access);$('request').hidden=pending;$('request-status').hidden=!pending&&!other;
  if(pending||other){$('status-title').textContent=pending?'Access requested':'Access '+s.access;$('status-detail').textContent=pending?'Give Manda this request ID to confirm your @'+s.handle+' request. This device unlocks after approval.':'You can submit a new request from this device.';$('request-id').textContent=(s.id||'').toUpperCase();}return;}
 if(!preview)preview=createBoard($('preview-board'));
 preview.draw(s.board,s.mode);$('host-name').textContent='@'+s.handle;$('connection').textContent=s.feed.status;
 $('feed-detail').textContent=s.feed.received?s.feed.received+' LIVE events · Last: '+s.feed.last:'Waiting for the first LIVE chat or gift.';
 const playing=s.board.phase==='playing';
 $('phase').textContent=playing?(s.mode==='practice'?'Rehearsal':'Live heist'):s.board.phase==='ended'?'Heist complete':'Ready';
 $('start-live').disabled=playing||s.feed.status!=='Connected';$('start-practice').disabled=playing;$('end').disabled=s.board.phase==='ready';$('practice').hidden=!playing||s.mode!=='practice';
 const link=location.origin+'/overlay#'+s.overlay;$('open-overlay').href=link;$('copy-target').value=link;
 if(!settingsLoaded){$('minutes').value=s.minutes;for(const [k,v] of Object.entries(s.rules))$('settings').elements[k].value=v;settingsLoaded=true;}
 if(s.storeError)notice('Saving is delayed. Keep the host panel open.');
}
async function control(data){if(busy)return;busy=true;version++;try{show(await api('control',data));}catch(e){notice(e.message)}finally{busy=false;version++;}}
$('request').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;version++;try{show(await api('request',{handle:$('handle').value}));}catch(e){notice(e.message)}finally{busy=false;version++;}};
for(const action of ['connect','disconnect','end'])$(action).onclick=()=>control({action});
for(const mode of ['live','practice'])$('start-'+mode).onclick=()=>control({action:'start',mode});
for(const b of document.querySelectorAll('[data-effect]'))b.onclick=()=>control({action:'practice',side:$('side').value,effect:b.dataset.effect,number:$('num').value});
$('sound').onclick=async()=>{if(await preview.enable())$('sound').textContent='Rehearsal beeps enabled';};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('copy-target').value);notice('Overlay link copied');}catch{$('copy-target').hidden=false;$('copy-target').select();notice('Copy the selected overlay link');}};
$('settings').onsubmit=async e=>{e.preventDefault();await control({action:'settings',minutes:Number($('minutes').value),rules:Object.fromEntries(new FormData(e.target))});};
async function refresh(){const v=version;if(!busy)try{const s=await api('host');if(!busy&&v===version)show(s);}catch{notice('Reconnecting to Vault Wars…');}setTimeout(refresh,state.access==='approved'?1000:5000);}
refresh();if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
