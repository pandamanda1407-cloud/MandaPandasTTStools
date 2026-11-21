import assert from 'node:assert/strict';
import test from 'node:test';
import {applyGift,clock,crew,defaults,fresh,guess,input,visible} from './game.mjs';
import {normalize} from './live.mjs';
test('101 viewers stay balanced, same viewer keeps a crew',()=>{
 const g=fresh();for(let i=0;i<101;i++)crew(g,String(i),'Viewer');
 const first=crew(g,'0','Renamed');assert.equal(first,g.players['v:0']);assert.equal(g.counts.red+g.counts.blue,101);assert.equal(Math.abs(g.counts.red-g.counts.blue),1);
});
test('all twelve slots are solved in sequence with no hidden number in the overlay',()=>{
 const g=fresh();for(let i=0;i<12;i++){const board=visible(g);assert.equal(board.teams.red.door,i<3?1:i<7?2:3);assert.equal(board.teams.red.code,undefined);assert.equal(board.players,undefined);guess(g,'red',g.teams.red.code[i],'Tester');}assert.equal(g.winner,'red');assert.equal(g.phase,'ended');assert.equal(visible(g).teams.red.slots.length,5);
});
test('a Corgi clears ten unused wrong guesses, caps at 99',()=>{
 const g=fresh();applyGift(g,'red','clear');assert.equal(g.teams.red.out.length,10);const n=g.teams.red.out[0];guess(g,'red',n,'Test');assert.equal(g.teams.red.out.length,10);applyGift(g,'red','clear',20);assert.equal(new Set(g.teams.red.out).size,99);assert.ok(!g.teams.red.out.includes(g.teams.red.code[0]));
});
test('sabotage across a door boundary changes the erased answer',()=>{
 const g=fresh();const old=g.teams.red.code[2];for(let i=0;i<3;i++)guess(g,'red',g.teams.red.code[i],'Test');applyGift(g,'blue','erase');assert.equal(g.teams.red.solved,2);assert.notEqual(g.teams.red.code[2],old);assert.equal(visible(g).teams.red.door,1);
});
test('matching gift saves a pending team, deadline resets just the targeted crew',()=>{
 const now=1000,g=fresh(10,now);g.teams.blue.solved=5;g.teams.red.solved=1;
 applyGift(g,'red','pending',1,now);assert.equal(g.teams.blue.pending,31000);guess(g,'blue',g.teams.blue.code[5],'Test');assert.equal(g.teams.blue.solved,5);
 applyGift(g,'blue','pending',1,30999);assert.equal(g.teams.blue.pending,0);assert.equal(g.teams.blue.solved,5);
 applyGift(g,'red','pending',1,40000);const old=[...g.teams.blue.code];clock(g,70000);assert.equal(g.teams.blue.solved,0);assert.ok(old.every((n,i)=>g.teams.blue.code[i]!==n));assert.equal(g.teams.red.solved,1);
});
test('instant reset clears the pending window, global clock locks both doors',()=>{
 const g=fresh(1,1000);g.teams.red.solved=11;g.teams.blue.solved=4;applyGift(g,'blue','pending',1,1100);applyGift(g,'blue','instant');assert.equal(g.teams.red.pending,0);assert.equal(g.teams.red.solved,0);assert.equal(g.teams.blue.solved,4);assert.equal(g.ends,61000);clock(g,61000);assert.equal(g.winner,'house');assert.equal(g.teams.blue.solved,0);
});
test('SDK streaks, duplicate gifts and replayed chat produce one action',()=>{
 const g=fresh(),user={userId:'401',uniqueId:'tester'},d={user,giftDetails:{giftType:1,giftName:'Corgi',diamondCount:299},giftId:123,groupId:'7',repeatCount:2,event:{msgId:'15'}};
 assert.equal(normalize('gift',{...d,repeatEnd:0}),null);const gift=normalize('gift',{...d,repeatEnd:1});input(g,gift,defaults);input(g,gift,defaults);
 assert.equal(g.teams[g.players['v:401']].out.length,20);
 const chat=normalize('chat',{user,comment:'72',event:{msgId:'23'}});assert.equal(chat.eventId,'chat:23');assert.equal(input(g,chat,defaults),true);assert.equal(input(g,chat,defaults),false);
});
test('each team has its own erase gift; 5K, Rose Nebula and edited rules are recognized',()=>{
 const g=fresh();g.players['v:r']='red';g.players['v:b']='blue';g.teams.blue.solved=2;g.teams.red.solved=1;
 const send=(id,gift,coins)=>input(g,{type:'gift',id,name:id,gift,coins},defaults);
 send('r','Galaxy',1000);assert.equal(g.teams.blue.solved,1);send('b','Glowing Jellyfish',0);assert.equal(g.teams.red.solved,0);
 send('r','Example',5000);assert.ok(g.teams.blue.pending);send('b','Example',5000);assert.equal(g.teams.blue.pending,0);send('r','Rose Nebula',15000);assert.equal(g.teams.blue.solved,0);
 const old=g.teams.red.out.length;input(g,{type:'gift',id:'r',giftId:'999'}, {...defaults,clear:'999'});assert.equal(g.teams.red.out.length,old+10);
});
