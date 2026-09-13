/* Public-history hand hypotheses, terminal rollouts and bounded sampled endgames. */
(function(root) {
  'use strict';
  const Core = typeof module !== 'undefined' && module.exports ? require('./poker-core.js') : root.FlyPoker;
  const POW = Array.from({length:13},(_,i)=>5**i);
  const key = counts => counts.reduce((sum,n,i)=>sum+n*POW[i],0);
  const decode = code => {const c=new Uint8Array(13);for(let i=0;i<13;i++){c[i]=code%5;code=Math.floor(code/5);}return c;};
  function cardsFrom(c) {const cards=[];for(let i=0;i<13;i++)for(let j=0;j<c[i];j++)cards.push(i*4+j+(i===11?1:0));return cards;}
  function canBeatCounts(c,target) {
    if(!target)return c.some(n=>n>0);
    for(let i=0;i<13;i++)if(c[i]===4&&(target.type!=='bomb'||i+3>target.high))return true;
    if(target.type==='bomb')return false;
    const kind=target.type, size=c.reduce((s,n)=>s+n,0);
    if(['single','pair','triple','triple-one','triple-two'].includes(kind)) {
      const each=kind==='single'?1:kind==='pair'?2:3, wings=kind==='triple-one'?1:kind==='triple-two'?2:0;
      for(let i=target.high-2;i<13;i++)if(c[i]>=each&&size-c[i]>=wings)return true;
      return false;
    }
    if(kind.startsWith('four-'))return false; // Any available four would already be a legal bomb.
    const each=kind==='straight'?1:kind==='pair-run'?2:3, span=target.span;
    const wings=kind==='plane-one'?span:kind==='plane-two'?2*span:0;
    for(let end=Math.max(span-1,target.high-2);end<12;end++) {
      let held=0,okay=true;
      for(let i=end-span+1;i<=end;i++){if(c[i]<each){okay=false;break;}held+=c[i];}
      if(okay&&size-held>=wings)return true;
    }
    return false;
  }
  function constraints(view) {
    // A public pass may be voluntary. It reveals no hard rank restriction,
    // even when our simulator knows that the actor had no legal response.
    return [];
  }
  function consistent(counts,rules) {
    for(const rule of rules) {
      const then=counts.map((n,i)=>n+rule.known[i]);
      if(then.some(n=>n>4)||canBeatCounts(then,rule.target))return false;
    }
    return true;
  }
  function sampleHands(view,count,seed,config={}) {
    if(!Number.isInteger(view.opponentCount)||view.opponentCount<1||view.opponentCount>13)throw new Error('无效的对手剩余张数');
    if(config.softOpponent&&(view.history||[]).some(event=>event.actor===1&&event.kind==='play')) {
      const proposal=sampleHands(view,Math.max(128,count*4),seed),catalog=new Catalog(),observations=[];
      const events=view.history;let target=null;
      for(let i=0;i<events.length;i++) {
        const event=events[i];
        if(event.kind==='play') {
          if(event.actor===1)observations.push({move:event.move,target,later:events.slice(i).filter(e=>e.actor===1&&e.kind==='play').flatMap(e=>e.cards)});
          target=event.move;
        }else target=null;
      }
      const recent=observations.slice(-3),temperature=config.opponentTemperature??1.5,logs=proposal.hands.map(hand=> {
        let log=0;
        for(const observation of recent) {
          const own=key(Core.counts([...hand,...observation.later])),legal=catalog.legal(own,observation.target);
          if(legal.length<=1)continue;
          const scores=legal.map(move=> {
            const rest=own-move.code,remaining=catalog.hand(rest);
            return -3*catalog.groups(rest)+.16*move.size+.0015*remaining.c.reduce((sum,n,i)=>sum+n*(i+1)**2,0)-(move.type==='bomb'?.5:0);
          });
          const selected=legal.findIndex(move=>move.key===observation.move.key);
          if(selected<0)throw new Error('公开出牌不在重建手牌中');
          const max=Math.max(...scores),weights=scores.map(value=>Math.exp((value-max)/temperature)),total=weights.reduce((a,b)=>a+b,0);
          log+=Math.log(.7*weights[selected]/total+.3/legal.length);
        }
        return log;
      });
      const max=Math.max(...logs),weights=logs.map(value=>Math.exp(value-max)),total=weights.reduce((a,b)=>a+b,0),squares=weights.reduce((a,b)=>a+b*b,0);
      const random=Core.rng(seed^0x34987e91),hands=[];
      // Retain a 25% hard-evidence-only mixture: the opponent may prefer a different style.
      for(let i=0;i<count;i++) {
        let index;
        if(random()<.25)index=Math.floor(random()*proposal.hands.length);
        else {let pick=random()*total;index=0;while(index<weights.length-1&&pick>=weights[index])pick-=weights[index++];}
        hands.push(proposal.hands[index]);
      }
      return {...proposal,hands,unique:new Set(hands.map(cards=>key(Core.counts(cards)))).size,softObservations:recent.length,proposalHands:proposal.hands.length,effectiveHands:total*total/squares};
    }
    const rules=constraints(view), known=new Set([...view.hand,...view.played]), random=Core.rng(seed);
    const pool=Core.DECK.filter(id=>!known.has(id)&&consistent(Core.counts([id]),rules));
    if(pool.length<view.opponentCount)throw new Error('公开记录没有可行的剩余手牌');
    const result=[];let attempts=0, rescued=false;
    while(result.length<count&&attempts<Math.max(1000,count*60)) {
      attempts++;const sampled=Core.shuffle(pool,random).slice(0,view.opponentCount), c=Core.counts(sampled);
      if(consistent(c,rules))result.push(sampled);
    }
    if(result.length<count) {
      // Keep all hard evidence even when rejection sampling is inefficient.
      const ordered=Core.shuffle(pool,random), chosen=[], c=new Uint8Array(13);let visited=0;
      function find(at) {
        if(chosen.length===view.opponentCount)return [...chosen];
        if(++visited>100000||ordered.length-at<view.opponentCount-chosen.length)return null;
        for(let i=at;i<ordered.length;i++) {
          const id=ordered[i],r=Core.rank(id)-3;c[r]++;chosen.push(id);
          const answer=consistent(c,rules)?find(i+1):null;
          chosen.pop();c[r]--;if(answer)return answer;
        }
        return null;
      }
      if(!result.length){const answer=find(0);if(!answer)throw new Error('无法在预算内构造符合公开记录的手牌');result.push(answer);}
      rescued=true;while(result.length<count)result.push([...result[Math.floor(random()*result.length)]]);
    }
    return {hands:result, constraints:rules.length, attempts, rescued, unique:new Set(result.map(cards=>key(Core.counts(cards)))).size};
  }
  class Catalog {
    constructor(){this.cache=new Map();this.groupCache=new Map([[0,0]]);}
    hand(code) {
      if(this.cache.has(code))return this.cache.get(code);
      const c=decode(code),size=c.reduce((s,n)=>s+n,0),cards=cardsFrom(c);
      const moves=Core.enumerate(cards).map(move=>({...move,code:key(Core.counts(move.cards)),size:move.cards.length}));
      const value={code,c,size,moves};this.cache.set(code,value);return value;
    }
    legal(code,target){return this.hand(code).moves.filter(move=>Core.beats(move,target));}
    groups(code) {
      if(this.groupCache.has(code))return this.groupCache.get(code);
      const hand=this.hand(code),first=hand.c.findIndex(n=>n);let best=hand.size;
      for(const move of hand.moves) {
        if(Math.floor(move.code/POW[first])%5===0)continue;
        best=Math.min(best,1+this.groups(code-move.code));if(best===1)break;
      }
      this.groupCache.set(code,best);return best;
    }
  }
  const targetKey=target=>target?`${target.type}/${target.high}/${target.span}/${target.cards.length}`:'-';
  class Endgame {
    constructor(catalog,maxNodes=12000){this.catalog=catalog;this.maxNodes=maxNodes;this.nodes=0;this.memo=new Map();}
    solve(a,b,turn,target) {
      if(!a)return 1;if(!b)return -1;
      const cacheKey=`${a}/${b}/${turn}/${targetKey(target)}`;
      if(this.memo.has(cacheKey))return this.memo.get(cacheKey);
      if(this.nodes>=this.maxNodes)return 0;this.nodes++;
      const current=turn===0?a:b, hand=this.catalog.hand(current),legal=this.catalog.legal(current,target),win=turn===0?1:-1;
      if(legal.some(move=>move.size===hand.size)){this.memo.set(cacheKey,win);return win;}
      if(!legal.length) {
        const value=this.solve(a,b,1-turn,null);if(value)this.memo.set(cacheKey,value);return value;
      }
      let uncertain=false;
      const opponent=this.catalog.hand(turn===0?b:a);
      const ordered=legal.map(move=> {
        const rest=current-move.code,replies=this.catalog.legal(opponent.code,move);
        const replyFinish=replies.some(reply=>reply.size===opponent.size);
        return {move,priority:(replyFinish?-1000:0)+(replies.length?0:8)-this.catalog.groups(rest)*5+move.size*.2-move.high*.001};
      }).sort((left,right)=>right.priority-left.priority);
      for(const {move} of ordered) {
        const value=this.solve(turn===0?a-move.code:a,turn===1?b-move.code:b,1-turn,move);
        if(value===win){this.memo.set(cacheKey,win);return win;}if(!value)uncertain=true;
      }
      if(target) {
        const value=this.solve(a,b,1-turn,null);
        if(value===win){this.memo.set(cacheKey,win);return win;}if(!value)uncertain=true;
      }
      const value=uncertain?0:-win;if(value)this.memo.set(cacheKey,value);return value;
    }
  }
  function policy(catalog,own,other,target,random,style=0) {
    const hand=catalog.hand(own),legal=catalog.legal(own,target),opponent=catalog.hand(other);
    if(!legal.length)return null;
    const finish=legal.find(move=>move.size===hand.size);if(finish)return finish;
    const highHeld=hand.c.reduce((s,n,i)=>s+n*(i+1)**2,0);
    const safePass=target&&!opponent.moves.some(move=>move.size===opponent.size);
    let best=null,bestScore=safePass?-catalog.groups(own)*3+highHeld*.0015-.35:-Infinity;
    for(const move of legal) {
      const rest=own-move.code,remaining=catalog.hand(rest), replies=catalog.legal(other,move);
      if(replies.some(reply=>reply.size===opponent.size))continue;
      const control=!replies.length;
      const groups=catalog.groups(rest);
      const high=remaining.c.reduce((s,n,i)=>s+n*(i+1)**2,0);
      const score=-groups*3+move.size*.16+(control?1.6:0)+high*.0015-(move.type==='bomb'&&!control?.6:0)+(random()-.5)*(style?.9:.18);
      if(score>bestScore){bestScore=score;best=move;}
    }
    return bestScore>-Infinity?best:legal[Math.floor(random()*legal.length)];
  }
  function rollout(catalog,endgame,a,b,turn,target,random,options={}) {
    for(let ply=0;ply<50;ply++) {
      if(!a)return {win:1,solved:false};if(!b)return {win:0,solved:false};
      const remainingCards=catalog.hand(a).size+catalog.hand(b).size;
      if(options.reserveNodes&&!endgame.reserveActivated&&remainingCards<=(options.reserveCards??11)) {
        endgame.maxNodes=Math.max(endgame.maxNodes,endgame.nodes+options.reserveNodes);endgame.reserveActivated=true;
      }
      if(remainingCards<=(options.endgameCards??11)) {
        const exact=endgame.solve(a,b,turn,target);
        if(exact)return {win:exact>0?1:0,solved:true};
      }
      const move=policy(catalog,turn===0?a:b,turn===0?b:a,target,random,options.style||0);
      if(move){if(turn===0)a-=move.code;else b-=move.code;target=move;}else target=null;
      turn=1-turn;
    }
    throw new Error('模拟牌局没有在有限步数内结束');
  }
  function analyze(view,config={},seed=0) {
    const started=performance.now(), legal=Core.actions(view.hand,view.target), samples=config.samples??24;
    if(!legal.length)return {candidates:[],stats:{samples:0,rollouts:0,elapsedMs:0}};
    const posterior=sampleHands(view,samples,seed^0x7349ea19,config),catalog=new Catalog(),own=key(Core.counts(view.hand));
    const initialGroups=catalog.groups(own), counters=legal.map(()=>({wins:0,safe:0,control:0,solved:0}));
    let nodes=0;
    for(let i=0;i<posterior.hands.length;i++) {
      const other=key(Core.counts(posterior.hands[i])),opponent=catalog.hand(other),endgame=new Endgame(catalog,0);
      // The same hypothetical hand is evaluated for every root action.
      for(let j=0;j<legal.length;j++) {
        const budget=config.totalNodes?Math.min(config.maxNodes??20000,Math.max(1,Math.floor(config.totalNodes/(posterior.hands.length*legal.length)))):(config.maxNodes??600);
        endgame.maxNodes=endgame.nodes+budget;endgame.reserveActivated=false;
        const move=legal[j],target=move.type==='pass'?null:move,rest=own-key(Core.counts(move.cards)),reply=catalog.legal(other,target),counter=counters[j];
        counter.safe+=!reply.some(m=>m.size===opponent.size);counter.control+=move.type!=='pass'&&!reply.length;
        const random=Core.rng(seed^Math.imul(i+1,0x4129fa71));
        const value=rollout(catalog,endgame,rest,other,1,target,random,config);counter.wins+=value.win;counter.solved+=value.solved;
      }
      nodes+=endgame.nodes;
    }
    const candidates=legal.map((move,i)=> {
      const c=counters[i],rest=own-key(Core.counts(move.cards)),n=posterior.hands.length;
      const features=rest?[config.smoothWin?(c.wins+1)/(n+2):c.wins/n,c.safe/n,c.control/n,Math.max(0,(initialGroups-catalog.groups(rest))/initialGroups)]:[1,1,1,1];
      return {move,features,winRate:c.wins/n,solved:c.solved,rates:features.map(value=>12+220*value)};
    });
    return {candidates,stats:{samples:posterior.hands.length,constraints:posterior.constraints,samplingAttempts:posterior.attempts,samplingRescue:posterior.rescued,uniqueHands:posterior.unique,
      softObservations:posterior.softObservations||0,proposalHands:posterior.proposalHands||posterior.hands.length,effectiveHands:posterior.effectiveHands??posterior.unique,
      rollouts:posterior.hands.length*legal.length,endgameNodes:nodes,cachedHands:catalog.cache.size,elapsedMs:performance.now()-started}};
  }
  const api={key,decode,cardsFrom,canBeatCounts,constraints,consistent,sampleHands,Catalog,Endgame,policy,rollout,analyze};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.FlyPokerSearch=api;
})(globalThis);
