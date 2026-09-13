(function() {
  'use strict';
  const Core = globalThis.FlyPoker, I18N = globalThis.PokerI18n, $ = id => document.getElementById(id), term = I18N.ref;
  const say = (id, source, values = {}) => I18N.text($(id), source, values);
  const profiles = {practice: term('陪练'), full: term('认真')};
  const readSaved = key => {try {const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' ? value : {};} catch {return {};}};
  const save = (key, value) => {try {localStorage.setItem(key, JSON.stringify(value));} catch {}};
  const settings = readSaved('fly-poker-settings'), stored = readSaved('fly-poker-record');
  let profile = Object.hasOwn(profiles, settings.profile) ? settings.profile : 'full';
  const record = {wins: Number.isSafeInteger(stored.wins) && stored.wins >= 0 ? stored.wins : 0, losses: Number.isSafeInteger(stored.losses) && stored.losses >= 0 ? stored.losses : 0};
  let phase = 'ready', game = null, selected = new Set(), preferred = null, hintIndex = 0, last = [null, null];
  let gate = 0, timer = null, elapsed = 0, startedAt = 0, roundProfile = profile;
  const FINAL_PLAY_MS = 1800;
  let finalPlayRemaining = 0, finalPlayStarted = 0;
  const table = document.querySelector('.table'), profileButtons = [...document.querySelectorAll('[data-profile]')];
  const neural = globalThis.PokerNeural ? new PokerNeural() : null;
  const rival = globalThis.PokerRival ? new PokerRival() : null;
  const music = globalThis.PokerMusic ? new PokerMusic() : null;
  const brain = new PokerBrain(status => {
    if (status.phase === 'download' && phase === 'loading') {
      $('loadProgress').hidden = false; $('loadProgress').value = status.total ? status.loaded / status.total * 100 : 0;
      say('loadHint', status.compatibility ? '兼容下载 {loaded} / {total} MB' : '载入脑模型 {loaded} / {total} MB', {loaded: Math.round(status.loaded / 1048576), total: Math.round(status.total / 1048576)});
    } else if (status.phase === 'initializing') say('loadHint', '模型已载入，准备本机计算…');
    else if (status.phase === 'neural' && phase === 'playing' && game?.turn === 1 && game.revision === status.revision) {
      neural?.receive(status); rival?.neural(status.active);
    } else if (status.phase === 'thinking' && phase === 'playing' && game?.turn === 1 && game.revision === status.revision) {
      say('computeStatus', '果蝇正在比较 {done} / {total} 种出法', {done:status.done, total:status.total});
    } else if (status.phase === 'fallback') say('computeStatus', '正在切换到后台 CPU…');
    else if (status.phase === 'ready') say('computeStatus', '本机 {backend} · 脑模型已就绪', {backend: status.backend === 'cpu' ? 'CPU' : 'WebGPU'});
  });
  const formatTime = ms => {const seconds = Math.floor(ms / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;};
  const duration = () => elapsed + (phase === 'playing' ? performance.now() - startedAt : 0);
  function stopJobs() {gate++; clearTimeout(timer); timer = null; brain.cancel(); rival?.cancel();}
  function visualPause() {const held = document.hidden || phase === 'paused' || $('rulesDialog').open || $('methodsDialog').open; rival?.pause(held); music?.setSuspended(held);}
  function message(source) {say('turnMessage', source);}
  function card(id, mini = false) {
    const el = document.createElement(mini ? 'span' : 'button');
    el.className = `card${mini ? ' mini' : ''}${id % 4 === 1 || id % 4 === 3 ? ' red' : ''}`;
    I18N.text(el, '{suit}{rank}', {suit: term(Core.SUITS[id % 4]), rank: Core.label(Core.rank(id))}, 'aria-label');
    const rank = document.createElement('span'), suit = document.createElement('span'); rank.className = 'rank'; suit.className = 'suit';
    rank.textContent = Core.label(Core.rank(id)); suit.textContent = Core.SUITS[id % 4]; rank.setAttribute('aria-hidden','true'); suit.setAttribute('aria-hidden','true'); el.append(rank, suit);
    if (!mini) {
      el.type = 'button'; el.dataset.card = String(id); el.disabled = phase !== 'playing' || game?.turn !== 0;
      el.classList.toggle('selected', selected.has(id)); el.setAttribute('aria-pressed', String(selected.has(id)));
      el.addEventListener('click', () => {if (phase !== 'playing' || game?.turn !== 0) return; selected.has(id) ? selected.delete(id) : selected.add(id); preferred = null; renderHand();});
    }
    return el;
  }
  function selection() {
    if (!game || !selected.size) return null;
    try {return Core.select(game.hands[0], [...selected], game.table?.move || null, preferred);} catch {return null;}
  }
  function renderHand() {
    const focused = document.activeElement?.dataset?.card, area = $('hand'); area.replaceChildren();
    if (!game) for (let i = 0; i < 13; i++) {const el = document.createElement('span'); el.className = 'card ghost'; el.setAttribute('aria-hidden','true'); area.append(el);}
    else for (const id of game.hands[0]) area.append(card(id));
    const yourTurn = phase === 'playing' && game?.turn === 0, legal = yourTurn ? game.legal(0) : [], chosen = selection();
    $('youCount').textContent = String(game?.hands[0].length ?? 13);
    $('youCount').classList.toggle('urgent', phase === 'playing' && game?.hands[0].length === 1);
    $('hintButton').disabled = !yourTurn || !legal.length; $('clearButton').disabled = !yourTurn || !selected.size;
    $('playButton').disabled = !yourTurn || !chosen; $('passButton').disabled = !yourTurn || !game?.table;
    say('selectionLabel', selected.size ? chosen ? '{move} · {count} 张' : '已选 {count} 张 · 还不能出' : '点牌选中，再点出牌', {move:term(chosen?.name || ''), count:selected.size});
    say('handHint', yourTurn ? !legal.length ? '没有能压的牌，点「要不起」让果蝇继续领出。' : game.table ? '接 {move}：同牌型、同张数，点数更大。也可以点「要不起」，把牌留着。' : '你领出，可出任意合法牌型；领出时不能过牌。' : phase === 'ready' || phase === 'loading' ? '支持单张、对子、顺子、连对、三带、飞机与炸弹。' : phase === 'paused' ? '已暂停，手牌为你留着。' : phase === 'finishing' ? '最后一手已经出完，看看这局怎么结束的。' : phase === 'result' ? '先出完即获胜。下一局会重新洗牌。' : '果蝇出牌后，就轮到你。', {move:term(game?.table?.move.name || '')});
    if (focused) [...area.children].find(el => el.dataset.card === focused)?.focus({preventScroll:true});
  }
  function render() {
    document.querySelector('.poker-layout').dataset.phase = phase;
    $('startPanel').hidden = !['ready','loading'].includes(phase); $('pausePanel').hidden = phase !== 'paused'; $('resultPanel').hidden = phase !== 'result';
    $('pauseButton').disabled = phase !== 'playing'; say('profileTag', profiles[game ? roundProfile : profile]);
    $('startButton').disabled = phase === 'loading';
    for (const button of profileButtons) {button.disabled = phase === 'loading'; button.classList.toggle('selected', button.dataset.profile === profile); button.setAttribute('aria-pressed',String(button.dataset.profile === profile));}
    say('profileHint', profile === 'practice' ? '会记过牌、算残局，思考量少一些。' : '会比较更多可能手牌，并把残局算得更深。');
    table.classList.toggle('your-turn', phase === 'playing' && game?.turn === 0); table.classList.toggle('thinking',phase === 'playing' && game?.turn === 1);
    const count = game?.hands[1].length ?? 13; $('flyCount').textContent = String(count); $('flyCount').classList.toggle('urgent',phase === 'playing' && count === 1);
    $('cardBacks').replaceChildren(); for (let i = 0; i < count; i++) {const el = document.createElement('span'); el.className = 'card-back'; $('cardBacks').append(el);}
    for (let actor = 0; actor < 2; actor++) {
      const prefix = actor ? 'fly' : 'you', event = last[actor], area = $(prefix + 'Played'); area.replaceChildren();
      $(prefix + 'Zone').classList.toggle('current', Boolean(game?.table && game.table.actor === actor));
      $(prefix + 'Zone').classList.toggle('winning', game?.winner === actor);
      say(prefix + 'PlayLabel', event?.kind === 'play' ? '{actor} · {move}' : '{actor}出牌', {actor:term(actor ? '果蝇' : '你'), move:term(event?.move?.name || '')});
      if (event?.kind === 'play') for (const id of event.move.cards) area.append(card(id, true));
      else if (event?.kind === 'pass') {const el = document.createElement('span'); el.className = 'pass-label'; I18N.text(el, '要不起'); area.append(el);}
    }
    say('initiative', game ? game.table ? '{actor}出的 {move}' : '{actor}领出 · 任意牌型' : '随机先手 · 可主动过牌', {actor:term((game?.table?.actor ?? game?.turn) ? '果蝇' : '你'), move:term(game?.table?.move.name || '')});
    say('moveCount', '第 {count} 手', {count:game?.revision || 0}); $('clock').textContent = formatTime(duration()); renderHand();
  }
  function finish() {
    if (phase !== 'playing' || !game || game.winner === null) return;
    elapsed = duration(); phase = 'finishing'; stopJobs(); finalPlayRemaining = FINAL_PLAY_MS;
    const won = game.winner === 0; record[won ? 'wins' : 'losses']++; save('fly-poker-record', record);
    neural?.rest('这局已结束'); rival?.mode(won ? 'lose' : 'win'); visualPause();
    say('resultKicker', won ? '你赢了这局' : '果蝇赢了这局');
    say('resultTitle', won ? '你先出完了！' : '果蝇溜走了。');
    say('resultText', '{profile}局 · {time} · {turns} 手。{remaining}', {profile:profiles[roundProfile], time:formatTime(elapsed), turns:game.revision, remaining:term(won ? '果蝇还剩 {count} 张。' : '你还剩 {count} 张，再来一把。', {count:game.hands[won ? 1 : 0].length})});
    say('resultRecord', '这台设备的战绩：你 {wins} 胜 · 果蝇 {losses} 胜', {wins:record.wins, losses:record.losses});
    const finalMove = last[game.winner].move;
    say('resultLastLabel', '{actor}的最后一手 · {move}', {actor:term(won ? '你' : '果蝇'), move:term(finalMove.name)});
    $('resultLastPlay').replaceChildren(); for (const id of finalMove.cards) $('resultLastPlay').append(card(id, true));
    say('flyLine', won ? '这把你跑得快。再来。' : '最后这手，出完了。');
    message(term('{actor}打出{move}，手牌出完了！', {actor:term(won ? '你' : '果蝇'), move:term(finalMove.name)})); render(); scheduleResult();
    if (globalThis.matchMedia?.('(max-width: 900px)').matches) {
      const pinned = [$('rivalWindow'), $('neuralWindow')].filter(el => el && getComputedStyle(el).position === 'sticky');
      table.style.scrollMarginTop = `${pinned.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0) + 24}px`;
      table.scrollIntoView({block: 'start', behavior: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    }
  }
  function scheduleResult() {
    if (phase !== 'finishing' || timer !== null || document.hidden || $('rulesDialog').open || $('methodsDialog').open) return;
    const finishGate = gate; finalPlayStarted = performance.now();
    timer = setTimeout(() => {
      if (phase !== 'finishing' || gate !== finishGate) return;
      timer = null; finalPlayRemaining = 0; phase = 'result'; render();
      if (globalThis.matchMedia?.('(max-width: 900px) and (max-height: 600px)').matches) {
        $('againButton').scrollIntoView({block:'center', behavior:globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
      }
    }, finalPlayRemaining);
  }
  function holdResult() {
    if (phase !== 'finishing' || timer === null) return;
    finalPlayRemaining = Math.max(0, finalPlayRemaining - (performance.now() - finalPlayStarted));
    clearTimeout(timer); timer = null;
  }
  function commit(actor, cards, key) {
    if (phase !== 'playing' || game.turn !== actor) return;
    const leading = !game.table;
    const event = cards.length ? game.play(actor, cards, key) : game.pass(actor);
    // Only committed, now-public cards enter the presentation layer.
    rival?.commit({actor, cards: event.kind === 'play' ? event.move.cards : [], pass: event.kind === 'pass', count: game.hands[1].length});
    if (leading) last = [null, null]; last[actor] = event; selected.clear(); preferred = null; hintIndex = 0;
    if (game.winner !== null) {finish(); return;}
    render(); takeTurn();
  }
  function takeTurn() {
    if (phase !== 'playing' || !game || game.winner !== null) return;
    const turnGate = gate, revision = game.revision, actor = game.turn, legal = game.legal(actor);
    const current = () => phase === 'playing' && turnGate === gate && game?.revision === revision && game.turn === actor;
    if (actor === 0) {
      neural?.rest(); rival?.mode('watching');
      message(!legal.length ? '没有能压的牌，等你点「要不起」' : game.table ? '轮到你：接牌，或点「要不起」' : '你领出，想怎么出都行');
      say('flyLine', game.hands[1].length === 1 ? '只剩一张了，注意。' : game.hands[0].length === 1 ? '你只剩一张了。' : '到你了，我等着。'); return;
    }
    const animate = (cards, key) => {
      if (!current()) return;
      const wait = rival?.preparePlay(cards.length) || 0;
      message(term(cards.length ? '果蝇正在选出 {count} 张牌…' : '果蝇选择要不起。', {count:cards.length}));
      if (!wait) {commit(1, cards, key); return;}
      timer = setTimeout(() => {timer = null; if (current()) commit(1, cards, key);}, wait);
    };
    if (!legal.length) {
      neural?.rest('这手没有能压的牌'); rival?.mode('passing');
      message(term('{actor}要不起，{next}继续领出。', {actor:term(actor ? '果蝇' : '你'), next:term(actor ? '你' : '果蝇')}));
      timer = setTimeout(() => {timer = null; if (current()) animate([], Core.PASS.key);}, 800); return;
    }
    neural?.begin(); rival?.mode('thinking');
    message('果蝇正在想…'); say('flyLine', '让我算算，后面怎么走。');
    const began = performance.now();
    // Only this public observation crosses the worker boundary.
    brain.choose(game.view(1), roundProfile).then(result => {
      if (!current() || result.revision !== revision) return;
      if (result.cards.length) Core.select(game.hands[1], result.cards, game.table?.move || null, result.moveKey);
      else if (!game.table || result.moveKey !== Core.PASS.key) throw new Error('领出时不能过牌');
      neural?.selected(result); rival?.neural(result.active);
      say('computeStatus', '{backend} · {count} 次新响应 · {time} 秒', {backend:result.backend === 'cpu' ? 'CPU' : 'WebGPU', count:result.observations, time:(result.elapsedMs / 1000).toFixed(1)});
      timer = setTimeout(() => {timer = null; if (current()) animate(result.cards, result.moveKey);}, Math.max(0, 650 - (performance.now() - began)));
    }).catch(error => {if (!current()) return; pause(term('计算暂停：{error} 点继续可重试。', {error:term(error.message)}));});
  }
  function pause(reason = '双方和计时一起暂停。') {
    if (phase !== 'playing') return;
    elapsed = duration(); phase = 'paused'; stopJobs(); neural?.rest('牌局已暂停'); rival?.pause(true); music?.setSuspended(true); say('pauseReason', reason); render();
  }
  async function resume() {
    if (phase !== 'paused' || document.hidden || $('rulesDialog').open || $('methodsDialog').open) return;
    const resumeGate = gate; $('resumeButton').disabled = true;
    try {
      await brain.init(); if (phase !== 'paused' || gate !== resumeGate || document.hidden) return;
      phase = 'playing'; startedAt = performance.now(); visualPause(); render(); takeTurn();
    } catch (error) {say('pauseReason', error.message);}
    finally {$('resumeButton').disabled = false;}
  }
  async function start() {
    if (phase === 'loading') return;
    music?.activate();
    stopJobs(); const startGate = gate; game = null; selected.clear(); preferred = null; hintIndex = 0; last = [null,null]; elapsed = 0;
    neural?.clear(); rival?.reset(); visualPause();
    phase = 'loading'; roundProfile = profile; $('loadError').hidden = true; say('startButton', '准备果蝇…'); render();
    try {
      await brain.init(); if (gate !== startGate || phase !== 'loading') return;
      const values = new Uint32Array(1); globalThis.crypto?.getRandomValues ? crypto.getRandomValues(values) : values[0] = Math.floor(Math.random() * 4294967296);
      game = new Core.Game(values[0]); phase = document.hidden ? 'paused' : 'playing'; startedAt = performance.now();
      rival?.reset(game.hands[1].length); visualPause();
      say('pauseReason', '页面切到后台，牌局已暂停。'); render(); takeTurn();
    } catch (error) {if (gate !== startGate) return; phase = 'ready'; $('loadError').hidden = false; say('loadError', error.message); render();}
    finally {if (gate === startGate) {say('startButton', '发牌，开一局 ↗'); $('loadProgress').hidden = true;}}
  }
  function lobby() {stopJobs(); phase = 'ready'; game = null; last = [null,null]; selected.clear(); preferred = null; elapsed = 0; neural?.clear(); rival?.reset(); visualPause(); say('loadHint', brain.ready ? '脑模型已就绪，可以直接开局' : '首次载入约 39 MB · 后续自动使用缓存'); message('先把牌出完，就赢了。'); render();}
  $('startButton').addEventListener('click', start); $('againButton').addEventListener('click', start); $('restartPaused').addEventListener('click', start);
  $('pauseButton').addEventListener('click', () => pause()); $('resumeButton').addEventListener('click', resume); $('changeButton').addEventListener('click', lobby);
  $('hintButton').addEventListener('click', () => {if (phase !== 'playing' || game?.turn !== 0) return; const moves = game.legal(0); if (!moves.length) return; const move = moves[hintIndex++ % moves.length]; selected = new Set(move.cards); preferred = move.key; renderHand();});
  $('clearButton').addEventListener('click', () => {selected.clear(); preferred = null; renderHand();});
  $('playButton').addEventListener('click', () => {const move = selection(); if (move && phase === 'playing' && game?.turn === 0) {try {commit(0, move.cards, move.key);} catch (error) {message(error.message);}}});
  $('passButton').addEventListener('click', () => {if (phase === 'playing' && game?.turn === 0 && game.table) {clearTimeout(timer); commit(0, []);}});
  for (const button of profileButtons) button.addEventListener('click', () => {if (phase !== 'ready') return; profile = button.dataset.profile; save('fly-poker-settings',{profile}); render();});
  for (const prefix of ['rules','methods']) {
    $(prefix + 'Button').addEventListener('click', () => {pause('看完说明，点继续回到牌局。'); holdResult(); $(prefix + 'Dialog').showModal(); visualPause();});
    $(prefix + 'Dialog').addEventListener('close', () => {visualPause(); scheduleResult();});
  }
  document.addEventListener('visibilitychange', () => {if (document.hidden) {pause('页面切到后台，牌局已暂停。'); holdResult();} else scheduleResult(); visualPause();});
  window.addEventListener('pagehide', event => {pause(); holdResult(); rival?.pause(true); music?.setSuspended(true); brain.destroy(); if (!event?.persisted) {rival?.destroy(); neural?.destroy(); music?.destroy();}});
  window.addEventListener('pageshow', () => {visualPause(); scheduleResult();});
  setInterval(() => {if (phase === 'playing') $('clock').textContent = formatTime(duration());}, 500);
  render();
})();
