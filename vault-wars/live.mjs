import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
const identifier=v=>v!=null && String(v)!=='0' ? String(v) : '';
export function normalize(type,d){
 const user=d.user||{}, id=identifier(user.userId)||identifier(user.id)||user.uniqueId;
 if(!id)return null;
 const base={type,id:String(id),name:String(user.uniqueId||user.nickname||'Viewer').slice(0,32)};
 const msg=identifier(d.event?.msgId)||identifier(d.common?.msgId)||identifier(d.common?.messageId)||identifier(d.msgId);
 base.eventId=msg?type+':'+msg:'';
 if(type==='chat')return {...base,comment:String(d.comment??d.content??'')};
 const details=d.giftDetails||d.gift||{},info=d.extendedGiftInfo||{};
 const streak=Number(details.giftType??details.type??info.type)===1;
 if(streak&&!Number(d.repeatEnd))return null;
 const group=identifier(d.groupId);
 if(streak&&group)base.eventId='combo:'+id+':'+d.giftId+':'+group;
 return {...base,gift:String(details.giftName||details.name||info.name||''),giftId:String(d.giftId??''),coins:Number(details.diamondCount||info.diamond_count||info.diamondCount||0),count:streak?Math.max(1,Number(d.repeatCount)||1):1};
}
export function makeFeed(handle,onEvent){
 let connection,run=0,wanted=false,retry,attempt=0;
 const state={status:'Disconnected',received:0,last:'',at:0};
 function disconnect(){wanted=false;run++;clearTimeout(retry);const old=connection;connection=null;if(old)Promise.resolve(old.disconnect()).catch(()=>{});state.status='Disconnected';}
 function start(){disconnect();wanted=true;join(run);}
 function join(epoch){
  if(epoch!==run||!wanted)return;
  const sock=new TikTokLiveConnection(handle,{processInitialData:false,enableExtendedGiftInfo:true,...(process.env.EULER_API_KEY?{signApiKey:process.env.EULER_API_KEY}:{})});
  connection=sock;state.status=attempt?'Reconnecting':'Connecting';
  let closed=false;
  function again(reason){
   if(closed||epoch!==run||!wanted)return;
   closed=true;state.status=reason;Promise.resolve(sock.disconnect()).catch(()=>{});
   retry=setTimeout(()=>join(epoch),Math.min(90000,5000*2**Math.min(attempt++,5)));retry.unref();
  }
  function received(type,d){if(closed||epoch!==run||!wanted)return;const e=normalize(type,d);if(!e)return;state.received++;state.at=Date.now();state.last=type==='gift'?e.name+' · '+(e.gift||e.giftId):e.name+' · chat';onEvent(e);}
  sock.on(WebcastEvent.CHAT,d=>received('chat',d));sock.on(WebcastEvent.GIFT,d=>received('gift',d));
  sock.on(ControlEvent.ERROR,()=>{});sock.on(ControlEvent.DISCONNECTED,()=>again('Disconnected · retrying'));
  sock.on(WebcastEvent.STREAM_END,()=>{if(epoch===run&&!closed){disconnect();state.status='Stream ended';}});
  sock.connect().then(()=>{if(epoch!==run||!wanted||closed){Promise.resolve(sock.disconnect()).catch(()=>{});return;}attempt=0;state.status='Connected';})
   .catch(err=>{const category=String(err?.name)+' '+String(err?.message);again(/offline|not live/i.test(category)?'Channel offline · retrying':/sign|rate|api.?key|quota/i.test(category)?'LIVE provider unavailable · retrying':'Connection unavailable · retrying');});
 }
 return {state,start(){attempt=0;start();},disconnect};
}
