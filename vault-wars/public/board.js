const sides=['red','blue'];
const time=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
export function createBoard(el,autoSound=false){
 el.classList.add('screen');el.setAttribute('aria-label','Vault Wars stream board');
 function element(tag,cls,parent=el){const n=document.createElement(tag);n.className=cls;parent.append(n);return n;}
 const heist=element('div','global-time'),panels={};
 for(const side of sides){
  const num=element('div','door-no '+side),ticks=element('div','ticks '+side);
  for(let i=1;i<=100;i++){const tick=element('i','',ticks);tick.title=String(i);}
  const door=element('div','door '+side);door.dataset.door='1';const rotor=element('img','rotor',door);rotor.src='/board/'+side+'-rotor.webp';rotor.alt='';
  const slots=element('div','slots',door),read=element('div','readout',door);
  panels[side]={num,ticks,door,rotor,slots,read};
 }
 const prompt=element('div','join-line');prompt.textContent='Guess 1–100 to join a crew';
 const ticker=element('div','ticker'),practice=element('div','practice-tag'),win=element('div','win');win.hidden=true;
 const winner=element('strong','',win),sub=element('span','',win);
 let data,delta=0,sound=autoSound,ac,lastTone='';
 function context(){if(!ac)try{ac=new AudioContext()}catch{}return ac;}
 async function enable(){sound=true;await context()?.resume();return ac?.state==='running';}
 function beep(){if(!sound||!context()||ac.state!=='running')return;const o=ac.createOscillator(),v=ac.createGain();o.type='square';o.frequency.value=880;v.gain.setValueAtTime(.055,ac.currentTime);v.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.075);o.connect(v).connect(ac.destination);o.start();o.stop(ac.currentTime+.08);}
 function updateTime(){if(!data)return;const now=Date.now()+delta,remaining=Math.max(0,Math.ceil((data.ends-now)/1000));heist.textContent=data.phase==='ready'?'--:--':time(remaining);
  const alarms=[];for(const side of sides){const t=data.teams[side];if(!t.pending||data.phase!=='playing')continue;const sec=Math.max(0,Math.ceil((t.pending-now)/1000));const display=panels[side].read.querySelector('b');if(display)display.textContent=time(sec);if(sec)alarms.push(side+t.pending+'-'+sec);}
  const tone=alarms.join('/');if(tone!==lastTone&&tone)beep();lastTone=tone;
 }
 function draw(next,mode){
  const old=data;data=next;delta=next.now-Date.now();
  for(const side of sides){const p=panels[side],t=next.teams[side],prev=old?.teams[side];
   p.num.textContent='DOOR '+t.door+' / 3';
   const out=new Set(t.out);Array.from(p.ticks.children).forEach((node,i)=>node.classList.toggle('off',out.has(i+1)));
   if(prev&&prev.door!==t.door){p.door.classList.remove('turn','reset');void p.door.offsetWidth;p.door.classList.add(prev.door<t.door?'turn':'reset');}
   p.door.dataset.door=t.door;p.door.classList.toggle('alarm',!!t.pending);
   p.rotor.style.transform='rotate('+(t.motion*31)+'deg)';
   const sig=t.door+'/'+t.slots.join(',');if(p.slots.dataset.sig!==sig){p.slots.dataset.sig=sig;p.slots.replaceChildren();for(let i=0;i<t.width;i++)element('span','',p.slots).textContent=t.slots[i]??'—';}
   if(t.pending){if(!p.read.querySelector('b')){p.read.replaceChildren();element('small','',p.read).textContent='LOCKDOWN PENDING';element('b','',p.read);element('small','',p.read).textContent='MATCH 5K TO SAVE';}}
   else p.read.textContent=t.feedback;
  }
  const e=next.events?.[0];ticker.textContent=e?(e.side==='house'?'HOUSE':e.side.toUpperCase())+' · '+e.label:'';
  practice.textContent=mode==='practice'?'REHEARSAL':'';
  win.hidden=next.phase!=='ended';if(!win.hidden){winner.textContent=next.winner==='house'?'HOUSE WINS':next.winner.toUpperCase()+' WINS';sub.textContent=next.winner==='house'?'Both vaults locked · next heist in 8s':'All three vaults are open';}
  updateTime();
 }
 if(autoSound){context();document.addEventListener('pointerdown',enable,{once:true});}
 const timer=setInterval(updateTime,100);return {draw,enable,destroy(){clearInterval(timer);ac?.close();}};
}
if(document.body.classList.contains('overlay')){
 const token=location.hash.slice(1),board=createBoard(document.querySelector('#board'),true),status=document.querySelector('#status');
 async function poll(){try{const r=await fetch('/api/overlay',{headers:{authorization:'Bearer '+token}});if(!r.ok)throw Error(r.status===403?'Open the overlay link from your approved host panel.':'Reconnecting to the heist…');const b=await r.json();board.draw(b,b.mode);status.hidden=true;}catch(e){status.hidden=false;status.textContent=e.message;}setTimeout(poll,750);}
 poll();
}
