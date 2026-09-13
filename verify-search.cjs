const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('./dist/poker-core.js'),Search=require('./dist/poker-search.js');
const cards=ranks=>{const used={};return ranks.map(rank=>{const suit=used[rank]??(rank===14?1:0);used[rank]=suit+1;return(rank-3)*4+suit;});};
test('fast beating predicate agrees with complete legal enumeration',()=>{
  for(let seed=0;seed<250;seed++) {
    const game=new Core.Game(seed),targets=Core.enumerate(game.hands[0]);
    for(const target of targets)assert.equal(Search.canBeatCounts(Core.counts(game.hands[1]),target),Core.enumerate(game.hands[1],target).length>0,`${seed}/${target.key}`);
  }
  const catalog=new Search.Catalog();for(let seed=0;seed<50;seed++){const hand=new Core.Game(seed).hands[0],code=Search.key(Core.counts(hand));assert.deepEqual(Search.decode(code),Core.counts(hand));assert.equal(catalog.hand(code).size,13);}
});
test('public history uses relative seats and deep copies without hidden cards',()=>{
  const game=new Core.Game(72,0);game.play(0,game.legal()[0].cards);
  const a=game.view(0),b=game.view(1);assert.equal(a.history[0].actor,0);assert.equal(b.history[0].actor,1);
  a.history[0].cards.length=0;a.history[0].move.cards.length=0;assert(game.history[0].cards.length>0);assert(game.history[0].move.cards.length>0);
  assert(!('unused'in a));assert(!('hands'in a));assert(!('seed'in a));
});
test('a public pass permits stronger held cards and stronger cards played later',()=>{
  const target=Core.classify(cards([7]))[0],view={hand:cards([8,9]),opponentCount:3,played:[...target.cards,...cards([5])],revision:3,
    history:[{actor:0,kind:'play',cards:target.cards,move:target},{actor:1,kind:'pass',cards:[],move:null},{actor:1,kind:'play',cards:cards([5]),move:Core.classify(cards([5]))[0]}]};
  const result=Search.sampleHands(view,100,785);assert.equal(result.constraints,0);assert(result.hands.some(hand=>hand.some(id=>Core.rank(id)>7)));
  const later=cards([15]);view.history[2]={actor:1,kind:'play',cards:later,move:Core.classify(later)[0]};view.played=[...target.cards,...later];
  assert.equal(Search.constraints(view).length,0);assert.equal(Search.sampleHands(view,16,786).hands.length,16);
});
test('all sampled hands respect known cards and counts across 35 histories with voluntary passes',()=>{
  for(let seed=0;seed<35;seed++) {
    const game=new Core.Game(seed+19381),random=Core.rng(seed+319);
    for(let turn=0;turn<14&&game.winner===null;turn++) {
      const moves=game.legal();if(game.table&&(!moves.length||random()<.4))game.pass(game.turn);else {const move=moves[Math.floor(random()*moves.length)];game.play(game.turn,move.cards,move.key);}
    }
    if(game.winner!==null)continue;
    const raw=game.view(game.turn),allowed=new Set(Object.keys(raw));const view=new Proxy(raw,{get(target,key){assert(allowed.has(key),String(key));return target[key];}});
    const rules=Search.constraints(view),samples=Search.sampleHands(view,16,seed+3001);
    for(const hand of samples.hands){assert.equal(hand.length,view.opponentCount);assert(Search.consistent(Core.counts(hand),rules));assert(hand.every(id=>!view.hand.includes(id)&&!view.played.includes(id)));}
  }
});
function reference(a,b,turn,target,memo=new Map()) {
  if(!a.length)return 1;if(!b.length)return -1;
  const key=`${a}/${b}/${turn}/${target?.key||'-'}`;if(memo.has(key))return memo.get(key);
  const hand=turn===0?a:b,moves=Core.actions(hand,target),win=turn===0?1:-1;
  if(!moves.length)return reference(a,b,1-turn,null,memo);
  let value=-win;for(const move of moves){const chosen=new Set(move.cards),rest=hand.filter(id=>!chosen.has(id));if(reference(turn===0?rest:a,turn===1?rest:b,1-turn,move.type==='pass'?null:move,memo)===win){value=win;break;}}
  memo.set(key,value);return value;
}
test('soft action inference stays within public evidence and retains legal diverse hypotheses',()=>{
  for(let seed=0;seed<12;seed++) {
    const game=new Core.Game(seed+771121),random=Core.rng(seed+991);
    for(let turn=0;turn<12&&game.winner===null;turn++) {
      const moves=game.legal();if(!moves.length)game.pass(game.turn);else {const move=moves[Math.floor(random()*moves.length)];game.play(game.turn,move.cards,move.key);}
    }
    if(game.winner!==null)continue;
    const raw=game.view(game.turn),allowed=new Set(Object.keys(raw)),view=new Proxy(raw,{get(target,key){assert(allowed.has(key),String(key));return target[key];}});
    const sample=Search.sampleHands(view,16,seed+231,{softOpponent:true}),rules=Search.constraints(view);
    assert.equal(sample.hands.length,16);assert(sample.softObservations>0&&sample.softObservations<=3);
    assert(sample.effectiveHands>0&&sample.effectiveHands<=sample.proposalHands+1e-8);
    for(const hand of sample.hands){assert.equal(hand.length,view.opponentCount);assert(Search.consistent(Core.counts(hand),rules));assert(hand.every(id=>!view.hand.includes(id)&&!view.played.includes(id)));}
    assert.deepEqual(Search.sampleHands(view,16,seed+231,{softOpponent:true}),sample);
  }
});
test('bounded endgame results match an independent full game tree on 100 small deals',()=>{
  for(let seed=0;seed<100;seed++) {
    const game=new Core.Game(seed+500),a=game.hands[0].slice(0,2+seed%3),b=game.hands[1].slice(0,2+(seed+1)%3),turn=seed%2;
    const solver=new Search.Endgame(new Search.Catalog(),50000);
    assert.equal(solver.solve(Search.key(Core.counts(a)),Search.key(Core.counts(b)),turn,null),reference(a,b,turn,null),String(seed));
    const target=Core.classify(cards([3+seed%10]))[0];
    assert.equal(solver.solve(Search.key(Core.counts(a)),Search.key(Core.counts(b)),turn,target),reference(a,b,turn,target),`responding/${seed}`);
  }
  const own=Search.key(Core.counts(cards([3,15]))),other=Search.key(Core.counts(cards([4])));
  assert.equal(new Search.Endgame(new Search.Catalog(),1000).solve(own,other,0,null),1);
  assert.equal(new Search.Endgame(new Search.Catalog(),1).solve(own,other,0,null),0);
});
test('sampled endgames value keeping initiative over an immediate losing low card',()=>{
  const hand=cards([3,15]),opponent=cards([4]),known=new Set([...hand,...opponent]);
  const view={hand,opponentCount:1,target:null,played:Core.DECK.filter(id=>!known.has(id)),history:[],revision:0};
  const result=Search.analyze(view,{samples:8,maxNodes:1000,endgameCards:12,smoothWin:true},999);
  assert.equal(result.candidates.find(c=>c.move.high===15).winRate,1);assert.equal(result.candidates.find(c=>c.move.high===3).winRate,0);
  assert.equal(result.candidates.find(c=>c.move.high===15).features[0],.9);assert.equal(result.candidates.find(c=>c.move.high===3).features[0],.1);
  assert(result.candidates.every(c=>c.features.every(x=>x>=0&&x<=1)));
  const finish=Search.analyze({...view,hand:cards([15]),played:Core.DECK.filter(id=>!cards([15,4]).includes(id))},{samples:8},992).candidates[0];
  assert.deepEqual(finish.features,[1,1,1,1]);
});

test('passing preserves a winning straight that playing the available pair would break',()=>{
  const {view}=require('./release/pass-fixture.json'), known=new Set([...view.hand,...view.played]);
  const opponent=Core.DECK.filter(id=>!known.has(id));assert.equal(opponent.length,view.opponentCount);
  assert.equal(reference(view.hand,opponent,1,null),1);
  const pair=Core.enumerate(view.hand,view.target)[0],rest=view.hand.filter(id=>!pair.cards.includes(id));
  assert.equal(reference(rest,opponent,1,pair),-1);
  const result=Search.analyze(view,{samples:8,maxNodes:5000,endgameCards:17},771);
  assert.equal(result.candidates.length,2);assert.equal(result.candidates.find(c=>c.move.type==='pass').winRate,1);
  assert.equal(result.candidates.find(c=>c.move.type==='pair').winRate,0);
  const pass=result.candidates.find(c=>c.move.type==='pass');assert.equal(pass.features[2],0);assert.equal(pass.features[3],0);
});
