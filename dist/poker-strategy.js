/* Public-history planning encoded for a neural-only terminal-win readout. */
(function(root) {
  'use strict';
  const Core = typeof module !== 'undefined' && module.exports ? require('./poker-core.js') : root.FlyPoker;
  const Search = typeof module !== 'undefined' && module.exports ? require('./poker-search.js') : root.FlyPokerSearch;
  const PROFILES = Object.freeze({practice: Object.freeze({label: '陪练', samples: 12, maxNodes: 600, endgameCards: 11, contrast: true}), full: Object.freeze({label: '认真', samples: 64, maxNodes: 5000, endgameCards: 17, contrast: true})});
  function publicSeed(view) {
    let seed = Math.imul(view.opponentCount + 1, 2654435761);
    for (const id of [...view.hand, ...view.played]) seed = Math.imul(seed ^ (id + 1), 16777619);
    return seed >>> 0;
  }
  function partitions(hand, moves) {
    const initial = Core.counts(hand), patterns = moves.map(move => Core.counts(move.cards));
    const memo = new Map([['0000000000000', 0]]);
    function solve(c) {
      const key = Array.from(c).join('');
      if (memo.has(key)) return memo.get(key);
      const first = c.findIndex(n => n > 0); let best = c.reduce((s, n) => s + n, 0);
      for (const pattern of patterns) {
        if (!pattern[first] || pattern.some((n, i) => n > c[i])) continue;
        const rest = c.map((n, i) => n - pattern[i]);
        best = Math.min(best, 1 + solve(rest)); if (best === 1) break;
      }
      memo.set(key, best); return best;
    }
    return {initial, solve, before: solve(initial)};
  }
  function candidates(view, profileName = 'full') {
    if (!Object.hasOwn(PROFILES, profileName)) throw new Error('无效的果蝇强度');
    const seed = publicSeed(view), plan = Search.analyze(view, PROFILES[profileName], seed ^ Math.imul(view.revision + 1, 131));
    if(PROFILES[profileName].contrast&&plan.candidates.length) {
      const best=Math.max(...plan.candidates.map(candidate=>candidate.winRate));
      const bias=candidate=>.002*candidate.features[1]+.0002*candidate.features[2]+.00002*candidate.features[3];
      const groups=new Map();
      for(const candidate of plan.candidates) {
        const value=bias(candidate),range=groups.get(candidate.winRate)||[value,value];
        range[0]=Math.min(range[0],value);range[1]=Math.max(range[1],value);groups.set(candidate.winRate,range);
      }
      for(const candidate of plan.candidates) {
        if(candidate.move.cards.length===view.hand.length)continue;
        const [low,high]=groups.get(candidate.winRate),tie=high>low?(bias(candidate)-low)/(high-low):.5;
        candidate.features[0]=.06+.66*Math.exp((candidate.winRate-best)/.022)+.20*tie;
        candidate.rates=candidate.features.map(value=>12+220*value);
      }
    }
    const results = Core.shuffle(plan.candidates, Core.rng(seed ^ 0x73748a51));
    Object.defineProperty(results, 'stats', {value: plan.stats}); return results;
  }
  class Readout {
    constructor(model) {
      if (model?.format !== 'fly-poker-readout-v2' || model.featureCount !== 1411 || model.output !== 'sigmoid') throw new Error('出牌策略版本不兼容');
      this.model = model; this.x = new Float32Array(model.indices.length); this.h = new Float32Array(model.hidden);
      this.w1 = Float32Array.from(model.w1); this.b1 = Float32Array.from(model.b1); this.w2 = Float32Array.from(model.w2);
      this.features = new Float32Array(1411);
    }
    score(sample) {
      this.features.fill(0);
      for (const [i, n] of sample.r) this.features[i] = Math.log1p(n);
      return this.predict(this.features);
    }
    predict(features) {
      const m = this.model;
      for (let i = 0; i < m.indices.length; i++) this.x[i] = Math.max(-8, Math.min(8, (features[m.indices[i]] - m.mean[i]) * m.invStd[i]));
      this.h.set(this.b1);
      for (let i = 0; i < this.x.length; i++) for (let j = 0; j < m.hidden; j++) this.h[j] += this.x[i] * this.w1[i * m.hidden + j];
      let value = m.b2;
      for (let j = 0; j < m.hidden; j++) value += Math.max(0, this.h[j]) * this.w2[j];
      if (!Number.isFinite(value)) throw new Error('出牌评分无效');
      return 1 / (1 + Math.exp(-Math.max(-25, Math.min(25, value))));
    }
  }
  async function choose(view, profile, brain, readout, options = {}) {
    const started = performance.now(), choices = candidates(view, profile), seen = new Map();
    const cancelled = () => {if (options.cancelled?.()) throw new Error('Simulation cancelled');};
    cancelled();
    if (!choices.length) return {cards: [], revision: view.revision, considered: 0, observations: 0, elapsedMs: 0, backend: brain.backend};
    let best = null;
    const seed = (publicSeed(view) ^ Math.imul(view.revision + 1, 131)) >>> 0;
    for (let i = 0; i < choices.length; i++) {
      cancelled();
      const candidate = choices[i], key = candidate.rates.join(',');
      let response = seen.get(key);
      if (!response) {
        const sample = await brain.runFrame(candidate.rates, seed, {steps: readout.model.steps, reset: true});
        cancelled();
        response = {score: readout.score(sample), sample}; seen.set(key, response);
        options.observation?.({response: sample.r, active: sample.active, backend: brain.backend,
          candidate: i + 1, total: choices.length, observations: seen.size, modelSteps: readout.model.steps,
          elapsedMs: sample.elapsedMs, score: response.score});
      }
      if (!best || response.score > best.score) best = {move: candidate.move, ...response};
      options.progress?.({done: i + 1, total: choices.length, observations: seen.size});
      await options.yieldTask?.();
    }
    cancelled();
    return {cards: best.move.cards, moveKey: best.move.key, revision: view.revision, considered: choices.length, observations: seen.size,
      score: best.score, response: best.sample.r, active: best.sample.active, elapsedMs: performance.now() - started, backend: brain.backend, search: choices.stats};
  }
  const api = {PROFILES, publicSeed, candidates, partitions, Readout, choose};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FlyPokerStrategy = api;
})(globalThis);
