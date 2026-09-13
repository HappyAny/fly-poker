/* Two-player, 13-card shedding game. Both seats use the same rules. */
(function(root) {
  'use strict';
  const SUITS = ['♠', '♥', '♣', '♦'];
  const NAMES = {single: '单张', pair: '对子', triple: '三张', 'triple-one': '三带一', 'triple-two': '三带二',
    straight: '顺子', 'pair-run': '连对', 'triple-run': '三顺', 'plane-one': '飞机带单', 'plane-two': '飞机带二',
    bomb: '炸弹', 'four-one': '四带一', 'four-two': '四带二', 'four-three': '四带三'};
  const DECK = Object.freeze(Array.from({length: 49}, (_, id) => id).filter(id => id !== 44));
  const RANKS = Array.from({length: 13}, (_, i) => i + 3);
  const PASS = Object.freeze({type: 'pass', name: '要不起', key: 'pass', cards: Object.freeze([]), high: 0, span: 0});
  const rank = id => Math.floor(id / 4) + 3;
  const label = value => ({11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2'}[value] || String(value));
  const cardText = id => SUITS[id % 4] + label(rank(id));
  function rng(seed) {let s = seed >>> 0; return () => {s += 0x6d2b79f5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296;};}
  function shuffle(cards, random) {const out = [...cards]; for (let i = out.length - 1; i > 0; i--) {const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]];} return out;}
  function checkCards(cards) {
    if (!Array.isArray(cards) || cards.length > 48 || new Set(cards).size !== cards.length || cards.some(id => !Number.isInteger(id) || !DECK.includes(id))) throw new Error('无效或重复的扑克牌');
  }
  function counts(cards) {const out = new Uint8Array(13); for (const id of cards) out[rank(id) - 3]++; return out;}
  function signature(move) {return `${move.type}/${move.cards.length}/${move.span}`;}
  function shape(type, high, span, cards) {
    const sorted = [...cards].sort((a, b) => a - b), c = counts(sorted);
    return {type, high, span, cards: sorted, key: `${type}/${high}/${span}/${Array.from(c).join('')}`, name: NAMES[type]};
  }
  function beats(move, target) {
    if (move.type === 'pass') return false;
    if (!target) return true;
    if (move.type === 'bomb') return target.type !== 'bomb' || move.high > target.high;
    return target.type !== 'bomb' && signature(move) === signature(target) && move.high > target.high;
  }
  function classify(cards) {
    checkCards(cards);
    if (!cards.length) return [];
    const c = counts(cards), size = cards.length, active = RANKS.filter(r => c[r - 3]);
    const out = [], add = (type, high, span = 1) => out.push(shape(type, high, span, cards));
    if (size === 1) add('single', active[0]);
    if (size === 2 && active.length === 1) add('pair', active[0]);
    if (size === 4 && active.length === 1) add('bomb', active[0]);
    for (const r of active) {
      if (c[r - 3] === 3 && size >= 3 && size <= 5) add(['triple', 'triple-one', 'triple-two'][size - 3], r);
      if (c[r - 3] === 4 && size >= 5 && size <= 7) add(['four-one', 'four-two', 'four-three'][size - 5], r);
    }
    const consecutive = active.at(-1) <= 14 && active.every((r, i) => i === 0 || r === active[i - 1] + 1);
    if (consecutive && active.length >= 5 && size === active.length) add('straight', active.at(-1), active.length);
    if (consecutive && active.length >= 2 && active.every(r => c[r - 3] === 2)) add('pair-run', active.at(-1), active.length);
    if (consecutive && active.length >= 2 && active.every(r => c[r - 3] === 3)) add('triple-run', active.at(-1), active.length);
    for (let span = 2; span <= 4; span++) {
      const wings = size === span * 4 ? 1 : size === span * 5 ? 2 : 0;
      if (!wings) continue;
      for (let start = 3; start + span - 1 <= 14; start++) {
        if (Array.from({length: span}, (_, i) => start + i).every(r => c[r - 3] === 3)) add(wings === 1 ? 'plane-one' : 'plane-two', start + span - 1, span);
      }
    }
    return [...new Map(out.map(move => [move.key, move])).values()];
  }
  function enumerate(hand, target = null) {
    checkCards(hand);
    const byRank = RANKS.map(r => hand.filter(id => rank(id) === r).sort((a, b) => a - b));
    const c = byRank.map(a => a.length), result = new Map();
    function add(type, high, span, wanted) {
      const cards = wanted.flatMap((n, i) => byRank[i].slice(0, n));
      const move = shape(type, high, span, cards);
      if (beats(move, target)) result.set(move.key, move);
    }
    function attachments(body, amount, type, high, span) {
      const chosen = body.slice(), available = c.map((n, i) => body[i] ? 0 : n);
      function walk(i, left) {
        if (!left) {add(type, high, span, chosen); return;}
        if (i === 13 || available.slice(i).reduce((s, n) => s + n, 0) < left) return;
        if (body[i]) {walk(i + 1, left); return;}
        for (let take = 0; take <= Math.min(left, available[i]); take++) {chosen[i] = take; walk(i + 1, left - take);}
        chosen[i] = body[i];
      }
      walk(0, amount);
    }
    for (let i = 0; i < 13; i++) {
      for (const [n, type] of [[1, 'single'], [2, 'pair'], [3, 'triple'], [4, 'bomb']]) if (c[i] >= n) {
        const body = Array(13).fill(0); body[i] = n; add(type, i + 3, 1, body);
        if (n === 3) for (let wing = 1; wing <= 2; wing++) if (hand.length >= n + wing) attachments(body, wing, wing === 1 ? 'triple-one' : 'triple-two', i + 3, 1);
        if (n === 4) for (let wing = 1; wing <= 3; wing++) if (hand.length >= n + wing) attachments(body, wing, ['four-one', 'four-two', 'four-three'][wing - 1], i + 3, 1);
      }
    }
    for (const [each, minimum, type] of [[1, 5, 'straight'], [2, 2, 'pair-run'], [3, 2, 'triple-run']]) {
      for (let start = 0; start < 12; start++) for (let end = start; end < 12 && c[end] >= each; end++) {
        const span = end - start + 1;
        if (span < minimum) continue;
        const body = Array(13).fill(0); for (let i = start; i <= end; i++) body[i] = each;
        add(type, end + 3, span, body);
        if (each === 3) for (let wing = 1; wing <= 2; wing++) if ((3 + wing) * span <= hand.length) attachments(body, wing * span, wing === 1 ? 'plane-one' : 'plane-two', end + 3, span);
      }
    }
    return [...result.values()].sort((a, b) => b.cards.length - a.cards.length || (a.type === 'bomb') - (b.type === 'bomb') || a.high - b.high || a.key.localeCompare(b.key));
  }
  function select(hand, cards, target = null, preferredKey = null) {
    checkCards(cards);
    if (cards.some(id => !hand.includes(id))) throw new Error('只能出自己手里的牌');
    const options = classify(cards).filter(move => beats(move, target));
    if (!options.length) throw new Error(target ? '需要相同牌型、相同张数，并且点数更大；也可以用炸弹。' : '这些牌还没有组成可出的牌型。');
    if (preferredKey) {
      const chosen = options.find(move => move.key === preferredKey);
      if (!chosen) throw new Error('这手牌不能按指定牌型打出');
      return chosen;
    }
    return options.sort((a, b) => b.span - a.span || a.high - b.high)[0];
  }
  function actions(hand, target = null) {
    const moves = enumerate(hand, target);
    return target ? [...moves, PASS] : moves;
  }
  class Game {
    constructor(seed, first) {
      const random = rng(seed), deck = shuffle(DECK, random);
      this.hands = [deck.slice(0, 13).sort((a, b) => a - b), deck.slice(13, 26).sort((a, b) => a - b)];
      this.unused = deck.slice(26); this.turn = first === 0 || first === 1 ? first : Math.floor(random() * 2);
      this.first = this.turn; this.table = null; this.history = []; this.revision = 0; this.winner = null;
    }
    legal(actor = this.turn) {return enumerate(this.hands[actor], this.table?.move || null);}
    play(actor, cards, preferredKey = null) {
      if (this.winner !== null || actor !== this.turn) throw new Error('还没有轮到你出牌');
      const move = select(this.hands[actor], cards, this.table?.move || null, preferredKey);
      const chosen = new Set(cards); this.hands[actor] = this.hands[actor].filter(id => !chosen.has(id));
      const event = {actor, kind: 'play', move, cards: [...cards], revision: ++this.revision};
      this.history.push(event); this.table = {actor, move};
      if (!this.hands[actor].length) this.winner = actor; else this.turn = 1 - actor;
      return event;
    }
    pass(actor) {
      if (this.winner !== null || actor !== this.turn || !this.table) throw new Error('现在需要领出一手牌');
      const event = {actor, kind: 'pass', cards: [], revision: ++this.revision}; this.history.push(event);
      this.turn = 1 - actor; this.table = null; return event;
    }
    view(actor) {
      return {hand: [...this.hands[actor]], opponentCount: this.hands[1 - actor].length,
        target: this.table ? {...this.table.move, cards: [...this.table.move.cards]} : null,
        played: this.history.flatMap(event => event.cards), revision: this.revision,
        history: this.history.map(event => ({actor: event.actor === actor ? 0 : 1, kind: event.kind, cards: [...event.cards],
          move: event.move ? {...event.move, cards: [...event.move.cards]} : null}))};
    }
  }
  const api = {SUITS, NAMES, DECK, RANKS, PASS, rank, label, cardText, rng, shuffle, counts, signature, classify, enumerate, actions, select, beats, Game};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FlyPoker = api;
})(globalThis);
