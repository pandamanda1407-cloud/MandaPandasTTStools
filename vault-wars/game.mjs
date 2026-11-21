import { randomInt } from 'node:crypto';
export const colors = ['red','blue'];
export const widths = [3,4,5];
export const defaults = { clear:'Corgi', redErase:'Galaxy', blueErase:'Glowing Jellyfish', pending:'', instant:'Rose Nebula' };
const clean=s=>String(s??'').trim().toLowerCase();
function different(previous){if(previous==null)return randomInt(1,101);const n=randomInt(1,100);return n>=previous?n+1:n;}
function vault(old){return {code:Array.from({length:12},(_,i)=>different(old?.code[i])),solved:0,out:[],pending:0,feedback:'Awaiting a guess',motion:0};}
export function fresh(minutes=10,now=Date.now()){return {phase:'playing',ends:now+minutes*60000,winner:null,teams:{red:vault(),blue:vault()},players:{},counts:{red:0,blue:0},events:[],seen:[],serial:0};}
export function idle(){const g=fresh();g.phase='ready';g.ends=0;return g;}
function note(g,side,label){g.events.unshift({n:++g.serial,side,label});g.events.length=Math.min(6,g.events.length);}
function restart(g,side){const t=g.teams[side];g.teams[side]=vault(t);g.teams[side].motion=t.motion+1;g.teams[side].feedback='Vaults sealed · back to door 1';note(g,side,'Lockdown · all doors reset');}
export function clock(g,now=Date.now()){
 if(g.phase!=='playing')return false;
 if(now>=g.ends){g.phase='ended';g.winner='house';for(const side of colors){g.teams[side]=vault(g.teams[side]);}note(g,'house','Time expired · the house wins');return true;}
 let changed=false;for(const side of colors)if(g.teams[side].pending&&now>=g.teams[side].pending){restart(g,side);changed=true;}return changed;
}
export function crew(g,id,name){const key='v:'+id;if(g.players[key])return g.players[key];const c=g.counts;const side=c.red===c.blue?colors[randomInt(2)]:(c.red<c.blue?'red':'blue');c[side]++;g.players[key]=side;note(g,side,name+' joined '+side.toUpperCase());return side;}
export function stage(n){return n<3?{ix:0,start:0}:n<7?{ix:1,start:3}:{ix:2,start:7};}
export function guess(g,side,n,name){
 const t=g.teams[side];if(t.pending||t.out.includes(n))return;
 t.motion++;if(n!==t.code[t.solved]){t.out.push(n);t.feedback=n+' ruled out';return;}
 t.solved++;t.out=[];t.feedback=n+' locked in';note(g,side,name+' cracked '+n);
 if(t.solved===12){g.phase='ended';g.winner=side;for(const color of colors)g.teams[color].pending=0;note(g,side,'Final vault open');}
 else if(t.solved===3||t.solved===7)note(g,side,'Door '+(stage(t.solved-1).ix+1)+' opened');
}
export function giftEffect(event,side,rules=defaults){
 const match=(target)=>target&&[clean(event.gift),String(event.giftId??'')].includes(clean(target));
 if(match(rules.instant))return 'instant';
 if(rules.pending?match(rules.pending):event.coins===5000)return 'pending';
 if(match(side==='red'?rules.redErase:rules.blueErase))return 'erase';
 if(match(rules.clear))return 'clear';
 return null;
}
export function applyGift(g,side,effect,total=1,now=Date.now()){
 const other=side==='red'?'blue':'red',own=g.teams[side],target=g.teams[other];
 if(effect==='clear'){
  if(own.pending)return;
  const pool=Array.from({length:100},(_,i)=>i+1).filter(n=>n!==own.code[own.solved]&&!own.out.includes(n));
  const count=Math.min(pool.length,10*total);for(let i=0;i<count;i++)own.out.push(pool.splice(randomInt(pool.length),1)[0]);
  if(count){own.feedback=count+' numbers cleared';note(g,side,own.feedback);}return;
 }
 if(effect==='erase'){
  if(!target.solved)return;
  const count=Math.min(target.solved,total);const old=target.solved;target.solved-=count;
  for(let i=target.solved;i<=Math.min(11,old);i++)target.code[i]=different(target.code[i]);
  target.out=[];target.motion++;target.feedback=count+' solved '+(count===1?'number':'numbers')+' erased';note(g,other,target.feedback);return;
 }
 if(effect==='pending'){
  if(own.pending){own.pending=0;own.feedback='Counter accepted';note(g,side,'Lockdown countered');return;}
  if(!target.pending){target.pending=now+30000;note(g,other,'Lockdown pending');}return;
 }
 if(effect==='instant')restart(g,other);
}
export function input(g,e,rules,now=Date.now()){
 clock(g,now);if(g.phase!=='playing'||!e?.id)return false;
 const numeric=/^\d{1,3}$/.test(String(e.comment??'').trim())?Number(e.comment):0;
 const check=/^!?crew$/i.test(String(e.comment??'').trim());
 if(e.type==='chat'&&!check&&!(numeric>=1&&numeric<=100))return false;
 if(e.type==='gift'&&!colors.some(c=>giftEffect(e,c,rules)))return false;
 if(!['chat','gift'].includes(e.type))return false;
 if(e.eventId){if(g.seen.includes(e.eventId))return false;g.seen.push(e.eventId);if(g.seen.length>1024)g.seen.shift();}
 const side=crew(g,e.id,e.name||'Viewer');
 if(e.type==='chat'){if(check)note(g,side,(e.name||'Viewer')+' · '+side.toUpperCase()+' crew');else guess(g,side,numeric,e.name||'Viewer');}
 else applyGift(g,side,giftEffect(e,side,rules),Math.max(1,Math.trunc(e.count)||1),now);
 return true;
}
export function visible(g){const teams={};for(const side of colors){const t=g.teams[side],s=stage(t.solved);teams[side]={door:s.ix+1,width:widths[s.ix],slots:t.code.slice(s.start,t.solved),out:t.out,pending:t.pending,feedback:t.feedback,motion:t.motion,count:g.counts[side]};}
 return {phase:g.phase,ends:g.ends,winner:g.winner,events:g.events,teams,now:Date.now()};}
