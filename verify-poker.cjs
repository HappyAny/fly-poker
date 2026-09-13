'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('./dist/poker-core.js');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Strategy = require('./dist/poker-strategy.js');
const hand = text => {const used = {}; return text.split(' ').map(s => {const r = ({J:11,Q:12,K:13,A:14,'2':15})[s] || Number(s); const suit = (used[r] ?? (r === 14 ? 1 : 0)); used[r] = suit + 1; return (r - 3) * 4 + suit;});};
const types = text => Core.classify(hand(text)).map(m => m.type);

test('the 48-card deck deals 13 per seat with no jokers or hidden cards in observations', () => {
  assert.equal(Core.DECK.length, 48); assert.equal(Core.DECK.filter(id => Core.rank(id) === 15).length, 1);
  assert.equal(Core.DECK.filter(id => Core.rank(id) === 14).length, 3);
  const game = new Core.Game(20260912); assert.equal(game.hands[0].length, 13); assert.equal(game.unused.length, 22);
  assert.equal(new Set([...game.hands.flat(), ...game.unused]).size, 48);
  const view = game.view(1); assert.deepEqual(Object.keys(view).sort(), ['hand','opponentCount','played','revision','target','history'].sort());
  assert.deepEqual(view.hand, game.hands[1]); view.hand.pop(); assert.equal(game.hands[1].length, 13);
});

test('every supported shape and attachment rule is recognized', () => {
  for (const [cards, type] of [['3','single'],['4 4','pair'],['5 5 5','triple'],['5 5 5 8','triple-one'],['5 5 5 8 9','triple-two'],
    ['3 4 5 6 7','straight'],['J Q K A 10','straight'],['3 3 4 4','pair-run'],['3 3 3 4 4 4','triple-run'],
    ['3 3 3 4 4 4 7 7','plane-one'],['3 3 3 4 4 4 5 6 7 8','plane-two'],['6 6 6 6','bomb'],
    ['6 6 6 6 8','four-one'],['6 6 6 6 8 9','four-two'],['6 6 6 6 8 9 J','four-three']]) assert(types(cards).includes(type), cards);
  for (const cards of ['3 4 5 6','J Q K A 2','3 3 5 5','3 3 3 4 4 4 5']) assert.equal(types(cards).length, 0, cards);
  assert(!types('A A A').includes('bomb'));
});

test('size, sequence length, and bomb precedence apply equally to both seats', () => {
  const move = text => Core.classify(hand(text))[0];
  assert(Core.beats(move('2'), move('A'))); assert(!Core.beats(move('3 3'), move('3')));
  assert(!Core.beats(move('4 5 6 7 8 9'), move('3 4 5 6 7')));
  assert(Core.beats(move('4 5 6 7 8'), move('3 4 5 6 7')));
  assert(Core.beats(move('3 3 3 3'), move('A'))); assert(!Core.beats(move('A'), move('3 3 3 3')));
  assert(Core.beats(move('4 4 4 4'), move('3 3 3 3')));
  assert.throws(() => Core.select(hand('3 3 4'), [0, 0]));
  assert.throws(() => Core.select(hand('3 3 4'), hand('5')));
});

test('enumeration agrees with exhaustive subset classification, including ambiguous planes', () => {
  const hands = [hand('3 3 3 4 4 4 5 5 5 6 6 6 7'), hand('7 7 7 7 8 9 10 J Q K A 2'), hand('3 3 4 4 5 5 6 6 7 8 9')];
  for (const cards of hands) {
    const actual = new Set(Core.enumerate(cards).map(m => m.key)), expected = new Set();
    for (let mask = 1; mask < 2 ** cards.length; mask++) {
      const selected = cards.filter((_, i) => mask & (1 << i));
      for (const m of Core.classify(selected)) expected.add(m.key);
    }
    assert.deepEqual(actual, expected);
  }
});

test('either seat may pass with a response, but may not pass when leading or out of turn', () => {
  const g = new Core.Game(1, 0); g.hands = [hand('K 3'), hand('4 5')];
  g.play(0, hand('K')); assert.equal(g.turn, 1); assert.equal(g.legal().length, 0); g.pass(1);
  assert.equal(g.turn, 0); assert.equal(g.table, null); assert.throws(() => g.pass(0));
  g.play(0, hand('3')); assert.equal(g.winner, 0); assert.throws(() => g.play(1, hand('4')));
  const must = new Core.Game(2, 0); must.hands = [hand('3 7'), hand('4 8')]; must.play(0, hand('3'));
  const revision = must.revision; assert.throws(() => must.pass(0)); assert.equal(must.revision, revision);
  assert(must.legal(1).length); must.pass(1); assert.equal(must.revision, revision + 1); assert.equal(must.turn, 0); assert.equal(must.table, null);
  const mirror = new Core.Game(3, 1); mirror.hands = [hand('4 8'), hand('3 7')]; mirror.play(1, hand('3'));
  const before = [...mirror.hands[0]]; mirror.pass(0); assert.deepEqual(mirror.hands[0], before); assert.equal(mirror.turn, 1); assert.equal(mirror.table, null);
  assert.equal(Core.actions(hand('4 8'), Core.classify(hand('3'))[0]).at(-1), Core.PASS);
  assert(Core.actions(hand('4 8')).every(move => move.type !== 'pass'));
});

test('random legal games finish, preserve all cards, and never exceed the finite move bound', () => {
  for (let seed = 0; seed < 150; seed++) {
    const game = new Core.Game(seed), random = Core.rng(seed + 999);
    while (game.winner === null) {
      const moves = game.legal(); if (game.table && (!moves.length || random() < .35)) game.pass(game.turn); else game.play(game.turn, moves[Math.floor(random() * moves.length)].cards);
      assert(game.revision <= 50);
      const all = [...game.hands.flat(), ...game.unused, ...game.history.flatMap(e => e.cards)];
      assert.equal(all.length, 48); assert.equal(new Set(all).size, 48);
    }
    assert.equal(game.hands[game.winner].length, 0);
  }
});

test('minimum remaining plays is exact, and both search budgets use public information only', () => {
  for (const [text,n] of [['3 4 5 6 7',1],['3 3 4 4 5',2],['3 3 3 4 4 4 8 9',1],['3 5 7 9',4]]) {
    const cards = hand(text); assert.equal(Strategy.partitions(cards, Core.enumerate(cards)).before,n);
  }
  const view = new Core.Game(6221,1).view(1), allowed = new Set(Object.keys(view));
  const restricted = new Proxy(view,{get(target,key) {assert(allowed.has(key),String(key)); return target[key];}});
  const fine = Strategy.candidates(restricted,'full'), coarse = Strategy.candidates(restricted,'practice');
  assert.deepEqual(new Set(fine.map(c=>c.move.key)),new Set(Core.enumerate(view.hand).map(c=>c.key)));
  assert.deepEqual(new Set(fine.map(c=>c.move.key)),new Set(coarse.map(c=>c.move.key)));
  assert.equal(fine.stats.samples,64);assert.equal(coarse.stats.samples,12);
  for(const candidate of [...fine,...coarse])for(const rate of candidate.rates)assert(rate>=12&&rate<=232);
  assert.throws(()=>Strategy.candidates(view,'__proto__'));
});

test('learned score matches Python fixtures and neural response is its sole observation input', () => {
  const model = require('./dist/data/poker-policy.json'), data = require('./training/calibration-parity.json'), readout = new Strategy.Readout(model);
  for(let i=0;i<data.features.length;i++) assert(Math.abs(readout.predict(data.features[i])-data.scores[i])<2e-6);
  const sample = new Proxy({r:[[model.indices[0],4]]},{get(target,key){assert.equal(key,'r');return target.r;}});
  const score = readout.score(sample); assert(Number.isFinite(score));
  const zero = readout.score({r:[]}); assert(Number.isFinite(zero)); assert.equal(zero,readout.score({r:[]}));
});

test('every distinct current stimulus is computed fresh, with cancellation and no heuristic fallback', async () => {
  const view = new Core.Game(99101,1).view(1), candidates = Strategy.candidates(view,'practice'), distinct = new Set(candidates.map(c=>c.rates.join(','))).size;
  const calls = [], brain = {backend:'test', async runFrame(rates,seed,options){calls.push({rates,seed,options});return {r:[[0,rates[0]]],active:1};}};
  const readout = {model:{steps:900},score:sample=>sample.r[0][1]};
  const result = await Strategy.choose(view,'practice',brain,readout);
  assert.equal(calls.length,distinct); assert.equal(result.considered,candidates.length); assert.equal(result.observations,distinct);
  assert.equal(new Set(calls.map(c=>c.seed)).size,1); assert(calls.every(c=>c.options.reset&&c.options.steps===900));
  const selected = candidates.find(c=>c.move.key===result.moveKey); assert.equal(selected.rates[0],Math.max(...candidates.map(c=>c.rates[0])));
  await Strategy.choose(view,'practice',brain,readout); assert.equal(calls.length,distinct*2);
  let cancelled=false, runs=0;
  await assert.rejects(Strategy.choose(view,'full',{backend:'test',async runFrame(){runs++;cancelled=true;return {r:[]};}},readout,{cancelled:()=>cancelled}),/cancelled/); assert.equal(runs,1);
  await assert.rejects(Strategy.choose(view,'full',{backend:'test',async runFrame(){throw new Error('device failed');}},readout),/device failed/);
});

test('voluntary passing shares the neural candidate path and never overrides its selected score',async()=>{
  const {view}=require('./release/pass-fixture.json'), options=Strategy.candidates(view,'practice'), calls=[];
  assert.equal(options.length,2);assert(options.some(c=>c.move.type==='pass'));
  const brain={backend:'test',async runFrame(rates){calls.push(rates);return {r:[[0,rates[0]]],active:1};}};
  const high={model:{steps:900},score:s=>s.r[0][1]},low={model:{steps:900},score:s=>-s.r[0][1]};
  const pass=await Strategy.choose(view,'practice',brain,high);assert.equal(pass.moveKey,'pass');assert.equal(pass.cards.length,0);assert.equal(pass.observations,2);
  const play=await Strategy.choose(view,'practice',brain,low);assert.equal(play.cards.length,2);assert.equal(calls.length,4);
});

function harness({seed=5531,hold=false,first=0,failInit=false,savedProfile=null,setup=null,chooseMove=null,visuals=false}={}) {
  const markup=fs.readFileSync(path.join(__dirname,'dist/index.html'),'utf8');
  let doc;
  class Element {
    constructor(){this.children=[];this.handlers={};this.dataset={};this.hidden=false;this.disabled=false;this.open=false;this.textContent='';this.classes=new Set();this.classList={toggle:(name,on)=>{if(on??!this.classes.has(name))this.classes.add(name);else this.classes.delete(name);}};}
    addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);}
    async emit(type){if(type==='click'&&this.disabled)return;for(const fn of this.handlers[type]||[])await fn({target:this});}
    setAttribute(key,value){this[key]=value;}
    append(...items){this.children.push(...items);}
    replaceChildren(){this.children=[];}
    showModal(){this.open=true;}
    focus(){doc.activeElement=this;}
  }
  const elements=new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const table=new Element(), choices=['practice','full'].map(profile=>{const el=new Element();el.dataset.profile=profile;return el;});
  doc=new Element();doc.hidden=false;doc.getElementById=id=>elements.get(id)||null;doc.querySelector=()=>table;doc.querySelectorAll=()=>choices;doc.createElement=()=>new Element();
  const events=new Element(),storage=new Map(savedProfile?[['fly-poker-settings',JSON.stringify({profile:savedProfile})]]:[]),games=[],requests=[],jobs=new Map(),intervals=[];
  let now=0,nextTimer=0,brain; const visualLog=[];
  class FakeRival {
    reset(count=13){visualLog.push(['reset',count]);}mode(value){visualLog.push(['mode',value]);}
    pause(value){visualLog.push(['pause',value]);}cancel(){visualLog.push(['cancel']);}
    preparePlay(count){visualLog.push(['prepare',count]);return 1200;}
    commit(value){visualLog.push(['commit',value]);}neural(value){visualLog.push(['active',value]);}destroy(){}
  }
  class FakeNeural {clear(){}begin(){visualLog.push(['begin']);}rest(label){visualLog.push(['rest',label]);}receive(value){visualLog.push(['receive',value]);}selected(value){visualLog.push(['selected',value]);}destroy(){}}
  class TrackedGame extends Core.Game {constructor(s){super(s,first);setup?.(this);games.push(this);}}
  class FakeBrain {
    constructor(onStatus){brain=this;this.onStatus=onStatus;this.cancelled=0;this.ready=false;}
    async init(){if(failInit){failInit=false;throw new Error('download failed');}this.ready=true;return {backend:'cpu'};}
    choose(view,profile){assert.deepEqual(Object.keys(view).sort(),['hand','opponentCount','played','revision','target','history'].sort()); const move=chooseMove?chooseMove(view):Core.enumerate(view.hand,view.target)[0]; const result={cards:move.cards,moveKey:move.key,revision:view.revision,elapsedMs:25,observations:1,backend:'cpu'};return hold?new Promise(resolve=>requests.push({resolve,result,profile})):Promise.resolve(result);}
    cancel(){this.cancelled++;} destroy(){this.ready=false;}
  }
  const environment={document:doc,FlyPoker:{...Core,Game:TrackedGame},PokerBrain:FakeBrain,console,performance:{now:()=>now},crypto:{getRandomValues:a=>{a[0]=seed++;return a;}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},setTimeout:(fn,delay)=>{const id=++nextTimer;jobs.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>jobs.delete(id),setInterval:fn=>{intervals.push(fn);return 1;},addEventListener:(...args)=>events.addEventListener(...args)};
  if(visuals){environment.PokerRival=FakeRival;environment.PokerNeural=FakeNeural;}
  environment.window=environment;vm.createContext(environment);vm.runInContext(fs.readFileSync(path.join(__dirname,'dist/poker-i18n.js'),'utf8'),environment);vm.runInContext(fs.readFileSync(path.join(__dirname,'dist/poker-game.js'),'utf8'),environment);
  return {elements,doc,events,choices,storage,games,requests,brain,jobs,visualLog,async tick(ms){now+=ms;for(const fn of intervals)fn();for(const[id,job]of [...jobs])if(job.at<=now){jobs.delete(id);job.fn();}await Promise.resolve();await Promise.resolve();},async resolve(){const r=requests.shift();r.resolve(r.result);await Promise.resolve();await Promise.resolve();}};
}

test('the real controller completes 12 games via card hints, manual passes, delayed results and replay',async()=>{
  const h=harness();assert.equal(h.elements.get('startPanel').hidden,false);assert.equal(h.elements.get('profileTag').textContent,'认真');
  await h.elements.get('startButton').emit('click');
  for(let round=0;round<12;round++){
    const game=h.games.at(-1);assert.equal(h.elements.get('hand').children.length,13);
    for(let guard=0;game.winner===null&&guard<80;guard++){
      if(game.turn===0&&game.legal().length){await h.elements.get('hintButton').emit('click');assert(!h.elements.get('playButton').disabled);await h.elements.get('playButton').emit('click');}
      else if(game.turn===0)await h.elements.get('passButton').emit('click');
      await h.tick(1000);
    }
    assert.notEqual(game.winner,null);await h.tick(1800);assert.equal(h.elements.get('resultPanel').hidden,false);const saved=JSON.parse(h.storage.get('fly-poker-record'));assert.equal(saved.wins+saved.losses,round+1);
    if(round<11)await h.elements.get('againButton').emit('click');
  }
  await h.elements.get('changeButton').emit('click');await h.choices[0].emit('click');assert.equal(JSON.parse(h.storage.get('fly-poker-settings')).profile,'practice');
  await h.elements.get('startButton').emit('click');await h.choices[1].emit('click');assert.equal(h.elements.get('profileTag').textContent,'陪练');
});

test('human passes wait for a click whether a beating play is available or not',async()=>{
  for(const canBeat of [false,true]) {
    const h=harness({first:0,setup:g=>{g.hands=[hand('4 8'),hand('5 6')];g.table={actor:1,move:Core.classify(hand(canBeat?'3':'K'))[0]};}});
    await h.elements.get('startButton').emit('click');const game=h.games[0],before=[...game.hands[0]];
    assert.equal(game.legal().length>0,canBeat);assert.equal(h.elements.get('passButton').disabled,false);
    await h.tick(120000);assert.equal(game.revision,0);assert.equal(game.turn,0);assert.equal(h.jobs.size,0);
    await h.elements.get('passButton').emit('click');assert.equal(game.revision,1);assert.equal(game.history[0].kind,'pass');assert.deepEqual(game.hands[0],before);
    assert.equal(game.turn,1);assert.equal(game.table,null);
  }
});

test('the controller accepts a neural voluntary pass and rejects passing while leading',async()=>{
  const h=harness({first:1,setup:g=>{g.hands=[hand('3 7'),hand('4 8')];g.table={actor:0,move:Core.classify(hand('3'))[0]};},chooseMove:()=>Core.PASS});
  await h.elements.get('startButton').emit('click');assert(h.games[0].legal().length);await h.tick(650);
  assert.equal(h.games[0].history[0].kind,'pass');assert.equal(h.games[0].turn,0);assert.equal(h.elements.get('passButton').disabled,true);
  assert.equal(h.elements.get('flyPlayed').children[0].textContent,'要不起');assert.equal(h.elements.get('pausePanel').hidden,true);
  const invalid=harness({first:1,chooseMove:()=>Core.PASS});await invalid.elements.get('startButton').emit('click');await invalid.tick(1000);
  assert.equal(invalid.games[0].revision,0);assert.equal(invalid.elements.get('pausePanel').hidden,false);
});

test('both winning hands stay visible for 1.8 seconds and remain in the result, with one record update',async()=>{
  for(const winner of [0,1]) {
    const h=harness({first:winner,setup:g=>{g.hands=[hand('3'),hand('4')];}});
    await h.elements.get('startButton').emit('click');
    if(winner===0){await h.elements.get('hintButton').emit('click');await h.elements.get('playButton').emit('click');}else await h.tick(650);
    assert.equal(h.games[0].winner,winner);assert.equal(h.elements.get('resultPanel').hidden,true);
    const prefix=winner?'fly':'you';assert.equal(h.elements.get(prefix+'Played').children.length,1);assert.equal(h.elements.get(prefix+'Count').textContent,'0');
    assert(h.elements.get('playButton').disabled&&h.elements.get('passButton').disabled&&h.elements.get('pauseButton').disabled);
    const clock=h.elements.get('clock').textContent;await h.tick(900);
    h.doc.hidden=true;await h.doc.emit('visibilitychange');await h.tick(30000);assert.equal(h.elements.get('resultPanel').hidden,true);
    h.doc.hidden=false;await h.doc.emit('visibilitychange');await h.events.emit('pageshow');assert.equal(h.jobs.size,1);
    await h.tick(899);assert.equal(h.elements.get('resultPanel').hidden,true);await h.tick(1);assert.equal(h.elements.get('resultPanel').hidden,false);
    assert.equal(h.elements.get('clock').textContent,clock);assert.equal(h.elements.get('resultLastPlay').children[0]['aria-label'],Core.cardText(winner?hand('4')[0]:hand('3')[0]));
    const saved=JSON.parse(h.storage.get('fly-poker-record'));assert.equal(saved.wins+saved.losses,1);await h.tick(10000);assert.equal(JSON.parse(h.storage.get('fly-poker-record')).wins+JSON.parse(h.storage.get('fly-poker-record')).losses,1);
  }
});

test('pause, hidden pages and restart discard stale neural decisions and freeze the clock',async()=>{
  const h=harness({first:1,hold:true});await h.elements.get('startButton').emit('click');const game=h.games[0];assert.equal(h.requests.length,1);
  await h.tick(12000);await h.elements.get('pauseButton').emit('click');const clock=h.elements.get('clock').textContent;
  await h.resolve();await h.tick(60000);assert.equal(game.revision,0);assert.equal(h.elements.get('clock').textContent,clock);
  await h.elements.get('resumeButton').emit('click');assert.equal(h.requests.length,1);h.doc.hidden=true;await h.doc.emit('visibilitychange');await h.resolve();await h.tick(60000);assert.equal(game.revision,0);
  h.doc.hidden=false;await h.elements.get('resumeButton').emit('click');await h.elements.get('rulesButton').emit('click');await h.elements.get('resumeButton').emit('click');assert.equal(h.elements.get('pausePanel').hidden,false);
  h.elements.get('rulesDialog').open=false;await h.elements.get('restartPaused').emit('click');const next=h.games.at(-1);assert.notEqual(next,game);
  await h.resolve();await h.tick(1000);assert.equal(next.revision,0);await h.resolve();await h.tick(1000);assert.equal(next.revision,1);
});

test('loading errors retry cleanly and invalid saved profiles use the new full default',async()=>{
  const h=harness({failInit:true,savedProfile:'__proto__'});await h.elements.get('startButton').emit('click');assert.equal(h.elements.get('loadError').hidden,false);assert.equal(h.games.length,0);assert.equal(h.elements.get('startButton').disabled,false);
  await h.elements.get('startButton').emit('click');assert.equal(h.games.length,1);assert.equal(h.elements.get('profileTag').textContent,'认真');assert.equal(h.elements.get('loadError').hidden,true);
});

test('a newly created worker receives the current cancellation epoch before choosing',async()=>{
  let worker;const source=fs.readFileSync(path.join(__dirname,'dist/poker-brain.js'),'utf8');
  class MockWorker{constructor(){worker=this;this.messages=[];}postMessage(message){this.messages.push(message);if(message.type==='init')queueMicrotask(()=>this.onmessage({data:{id:message.id,value:{backend:'cpu'}}}));}terminate(){}}
  const context={Worker:MockWorker,URL,document:{baseURI:'http://localhost/rhythm/'},queueMicrotask};vm.createContext(context);vm.runInContext(source,context);
  const client=new context.PokerBrain();client.cancel();await client.init();assert.equal(worker.messages[0].type,'cancel');assert.equal(worker.messages[0].epoch,1);
  const choice=client.choose(new Core.Game(2,1).view(1),'practice');const last=worker.messages.at(-1);assert.equal(last.epoch,1);client.cancel();await assert.rejects(choice,/cancelled/);
  client.destroy();
});

test('live observations correspond only to fresh computations and cannot change the selected move',async()=>{
  const {view}=require('./release/pass-fixture.json'), seen=[],samples=[];
  const brain={backend:'test',async runFrame(rates){const sample={r:[[0,rates[0]]],active:123,elapsedMs:2};samples.push(sample);return sample;}};
  const readout={model:{steps:900},score:s=>s.r[0][1]};
  const result=await Strategy.choose(view,'practice',brain,readout,{observation:value=>seen.push(value)});
  assert.equal(seen.length,samples.length);assert.equal(seen.length,result.observations);
  for(let i=0;i<seen.length;i++){assert.equal(seen[i].response,samples[i].r);assert.equal(seen[i].active,123);assert.equal(seen[i].observations,i+1);assert.equal(seen[i].modelSteps,900);}
  const silent=await Strategy.choose(view,'practice',brain,readout);assert.equal(result.moveKey,silent.moveKey);assert.deepEqual(result.response,silent.response);
  let cancelled=false,emitted=0;
  await assert.rejects(Strategy.choose(view,'practice',{backend:'test',async runFrame(){cancelled=true;return {r:[],active:0};}},readout,{cancelled:()=>cancelled,observation:()=>emitted++}),/cancelled/);
  assert.equal(emitted,0);
});

test('late worker telemetry is discarded after cancellation and after request completion',async()=>{
  let worker;const accepted=[];
  class MockWorker{constructor(){worker=this;this.messages=[];}postMessage(m){this.messages.push(m);if(m.type==='init')queueMicrotask(()=>this.onmessage({data:{id:m.id,value:{backend:'cpu'}}}));}terminate(){}}
  const context={Worker:MockWorker,URL,document:{baseURI:'http://localhost/rhythm/'},queueMicrotask};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'dist/poker-brain.js'),'utf8'),context);
  const client=new context.PokerBrain(s=>accepted.push(s));await client.init();const promise=client.choose(new Core.Game(2,1).view(1),'practice'),request=worker.messages.at(-1);
  const sample={type:'status',phase:'neural',requestId:request.id,epoch:request.epoch,response:[[1,3]],active:2};
  worker.onmessage({data:sample});assert.equal(accepted.length,1);client.cancel();await assert.rejects(promise,/cancelled/);worker.onmessage({data:sample});assert.equal(accepted.length,1);
  const next=client.choose(new Core.Game(3,1).view(1),'practice'),req=worker.messages.at(-1);worker.onmessage({data:{id:req.id,value:{cards:[1]}}});await next;
  worker.onmessage({data:{...sample,epoch:req.epoch,requestId:req.id}});assert.equal(accepted.length,1);client.destroy();
});

test('selection animation reveals only committed public cards and cancels before a paused move',async()=>{
  const h=harness({first:1,visuals:true});await h.elements.get('startButton').emit('click');const g=h.games[0];
  h.brain.onStatus({phase:'neural',revision:g.revision,response:[[1,4]],active:200,observations:1});assert.equal(h.visualLog.filter(e=>e[0]==='receive').length,1);
  await h.tick(650);assert.equal(g.revision,0);assert.equal(h.visualLog.at(-1)[0],'prepare');assert.equal(h.visualLog.at(-1).length,2);assert(!h.visualLog.some(e=>e[0]==='commit'));
  await h.tick(600);await h.elements.get('pauseButton').emit('click');await h.tick(5000);assert.equal(g.revision,0);
  h.brain.onStatus({phase:'neural',revision:g.revision,response:[[2,9]],active:300,observations:2});assert.equal(h.visualLog.filter(e=>e[0]==='receive').length,1);
  await h.elements.get('resumeButton').emit('click');await h.tick(650);await h.tick(1199);assert.equal(g.revision,0);await h.tick(1);assert.equal(g.revision,1);
  const event=h.visualLog.find(e=>e[0]==='commit')[1];assert.deepEqual(Object.keys(event).sort(),['actor','cards','count','pass']);assert.deepEqual(event.cards,g.history[0].cards);
  assert(h.visualLog.some(e=>e[0]==='mode'&&e[1]==='watching'));
});

test('both endings set their 3D reaction before the delayed result and replay resets it',async()=>{
  for(const winner of [0,1]){
    const h=harness({first:winner,visuals:true,setup:g=>{g.hands=[hand('3'),hand('4')];}});await h.elements.get('startButton').emit('click');
    if(winner===0){await h.elements.get('hintButton').emit('click');await h.elements.get('playButton').emit('click');}else{await h.tick(650);await h.tick(1200);}
    assert.equal(h.games[0].winner,winner);assert(h.visualLog.some(e=>e[0]==='mode'&&e[1]===(winner?'win':'lose')));assert.equal(h.elements.get('resultPanel').hidden,true);
    await h.tick(1800);assert.equal(h.elements.get('resultPanel').hidden,false);await h.elements.get('againButton').emit('click');assert.equal(h.games.length,2);assert(h.visualLog.filter(e=>e[0]==='reset').length>=4);
  }
});

test('card choreography selects in order before the push and honors reduced motion',()=>{
  const {actionDuration,actionPose}=require('./dist/poker-rival.js');
  for(const count of [1,2,5,13]){const duration=actionDuration(count);assert.equal(actionPose(count,199).selected,0);for(let i=1;i<=count;i++)assert.equal(actionPose(count,200+i*160).selected,i);assert.equal(actionPose(count,200+count*160).push,0);assert.equal(actionPose(count,duration).push,1);assert(actionPose(count,duration).complete);assert.equal(actionDuration(count,true),120);}
  assert.equal(actionDuration(0),460);assert(actionPose(0,460).complete);
});
