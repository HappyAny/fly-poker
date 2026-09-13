const test=require('node:test'),assert=require('node:assert/strict');
const PokerMusic=require('../dist/poker-music.js');
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function setup(saved){
 const instances=[],values=new Map(saved?[['fly-poker-music',JSON.stringify(saved)]]:[]);
 class Audio{
  constructor(url){this.src=url;this.paused=true;this.currentTime=0;this.playCalls=0;this.events={};instances.push(this);}
  addEventListener(name,handler){this.events[name]=handler;}
  play(){this.playCalls++;if(this.reject){this.reject=false;return Promise.reject(new Error('Autoplay blocked'));}if(this.defer)return new Promise(resolve=>{this.release=()=>{this.paused=false;resolve();};});this.paused=false;return Promise.resolve();}
  pause(){this.paused=true;}remove(){this.removed=true;}load(){this.error=null;}
 }
 const music=new PokerMusic({Audio,storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},document:{baseURI:'http://localhost:8891/'}});
 return{music,instances,values};
}
test('the track is lazy and a saved mute never creates or downloads audio',async()=>{
 const fresh=setup();assert.equal(fresh.instances.length,0);assert.equal(fresh.music.activated,false);fresh.music.activate();await flush();assert.equal(fresh.instances.length,1);assert.equal(fresh.instances[0].src,'http://localhost:8891/audio/table-lounge.mp3');assert.equal(fresh.instances[0].loop,true);
 const muted=setup({enabled:false,volume:.4});muted.music.activate();await flush();assert.equal(muted.instances.length,0);muted.music.setEnabled(true);await flush();assert.equal(muted.instances.length,1);assert.equal(muted.instances[0].volume,.4);
});
test('replay reuses one track and pause, mute and resume retain the playhead',async()=>{
 const {music,instances}=setup();music.activate();await flush();const audio=instances[0];audio.currentTime=12.5;
 music.activate();music.activate();assert.equal(instances.length,1);assert.equal(audio.playCalls,1);
 music.setSuspended(true);assert(audio.paused);music.setSuspended(false);await flush();assert(!audio.paused);assert.equal(audio.currentTime,12.5);
 music.setEnabled(false);assert(audio.paused);music.setEnabled(true);await flush();assert(!audio.paused);assert.equal(audio.currentTime,12.5);
 music.destroy();assert(audio.paused&&audio.removed);music.activate();assert.equal(instances.length,1);
});
test('volume and enabled preference persist and invalid values are constrained',async()=>{
 const {music,instances,values}=setup();music.activate();await flush();music.setVolume(.61);assert.equal(instances[0].volume,.61);assert.deepEqual(JSON.parse(values.get('fly-poker-music')),{enabled:true,volume:.61});
 music.setVolume(4);assert.equal(music.volume,1);music.setVolume(-1);assert.equal(music.volume,0);music.setVolume(NaN);assert.equal(music.volume,0);music.setEnabled(false);assert.equal(JSON.parse(values.get('fly-poker-music')).enabled,false);
});
test('playback failures are contained and a user action can retry',async()=>{
 const {music,instances}=setup();music.activate();await flush();music.setSuspended(true);instances[0].reject=true;music.setSuspended(false);await flush();assert(music.failed);assert(instances[0].paused);music.activate();await flush();assert(!music.failed);assert(!instances[0].paused);
 const unavailable=new PokerMusic({Audio:class{constructor(){throw Error('Unavailable');}},document:{},storage:{getItem(){throw Error('Denied');}}});assert.doesNotThrow(()=>unavailable.activate());assert(unavailable.failed);
});
test('a pending play cannot restart music after it was muted',async()=>{
 const {music,instances}=setup();music.activate();await flush();music.setSuspended(true);const audio=instances[0];audio.defer=true;music.setSuspended(false);music.setEnabled(false);audio.release();await flush();assert(audio.paused);assert.equal(music.shouldPlay,false);
});
