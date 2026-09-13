import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const [base = 'http://localhost:8892/', product = 'poker', mode = 'gzip', tag = 'local'] = process.argv.slice(2);
const defaultBackend = process.env.FLY_TEST_DEFAULT_BACKEND === '1';
const proxyUrl = process.env.PLAYWRIGHT_PROXY_SERVER ? new URL(process.env.PLAYWRIGHT_PROXY_SERVER) : null;
const proxy = proxyUrl ? {server: `${proxyUrl.protocol}//${proxyUrl.host}`,
  ...(proxyUrl.username ? {username: decodeURIComponent(proxyUrl.username), password: decodeURIComponent(proxyUrl.password)} : {})} : undefined;
if (!['poker', 'rhythm'].includes(product) || !['gzip', 'fallback', 'legacy'].includes(mode) || !/^[a-z0-9-]+$/.test(tag)) throw Error('Invalid test arguments');
const output = new URL('../release/', import.meta.url);
await fs.mkdir(output, {recursive: true});
const browser = await chromium.launch({...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {channel: 'chrome'}), headless: true,
  ...(proxy ? {proxy} : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(defaultBackend ? [] : ['--disable-blink-features=WebGPU'])]});
const errors = [], modelRequests = [], checks = [];
const screenshot = (page, name) => page.screenshot({path: new URL(`cloudflare-${tag}-${product}-${mode}-${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true});
try {
  const context = await browser.newContext({locale: 'en-US', viewport: {width: 1440, height: 900}});
  context.on('response', r => {if (new URL(r.url()).pathname.includes('/model/')) modelRequests.push({path: new URL(r.url()).pathname, status: r.status()});});
  if (mode === 'fallback') await context.route(url => url.pathname.includes('/chunks/brain-gzip-0-'), route => route.fulfill({status: 204}));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const q = globalThis.__cloudQA = {samples: [], observations: []};
    const hook = (name, wrap) => Object.defineProperty(globalThis, name, {configurable: true, set(K) {
      Object.defineProperty(globalThis, name, {value: wrap(K), writable: true, configurable: true});
    }});
    hook('FlyPoker', K => ({...K, Game: class extends K.Game {constructor() {super(99101, 1); q.game = this;}}}));
    hook('PokerNeural', K => class extends K {
      constructor() {super(); q.neural = this;}
      receive(value) {q.samples.push(value); super.receive(value);}
      selected(value) {q.selected = value; super.selected(value);}
    });
    hook('BrainClient', K => class extends K {
      constructor(status) {super(status); q.compute = this;}
      async observe(...args) {const value = await super.observe(...args); q.observations.push({backend: value.backend, active: value.active, outputs: value.r.length}); return value;}
    });
  });
  await page.goto(base);
  if (product === 'poker') {
    assert.equal(await page.locator('.github-link').getAttribute('href'), 'https://github.com/HappyAny/fly-poker');
    assert.equal(await page.locator('.github-link').getAttribute('aria-label'), 'Source code on GitHub');
    await page.locator('[data-profile="practice"]').click();
    await page.locator('#startButton').click();
    await page.waitForFunction(() => __cloudQA.game?.revision >= 1, null, {timeout: 120000});
    await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .2);
    const state = await page.evaluate(() => ({language: PokerI18n.language, backend: __cloudQA.selected.backend,
      observations: __cloudQA.samples.length, selected: __cloudQA.selected.response, rendered: __cloudQA.neural.sample.r,
      hand: __cloudQA.game.hands[0].length, ready: document.getElementById('startPanel').hidden,
      error: document.getElementById('loadError').textContent, width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      music: {playing: !document.querySelector('audio').paused, volume: document.querySelector('audio').volume, loop: document.querySelector('audio').loop}}));
    assert(state.ready && !state.error); assert(defaultBackend ? ['cpu', 'webgpu'].includes(state.backend) : state.backend === 'cpu'); assert.equal(state.observations, 24);
    assert.equal(state.hand, 13); assert.deepEqual(state.selected, state.rendered); assert.equal(state.language, 'en');
    assert.equal(state.width, state.scrollWidth); assert(state.music.playing && state.music.loop && state.music.volume === .25);
    checks.push({realGame: true, backend: state.backend, freshResponses: state.observations, displayedResponseMatchesDecision: true, music: state.music});
  } else {
    await page.locator('#startButton').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'playing' && __cloudQA.observations.some(v => v.outputs > 0), null, {timeout: 120000});
    const state = await page.evaluate(() => ({phase: document.body.dataset.phase, backend: __cloudQA.compute.backend, observations: __cloudQA.observations, error: document.getElementById('loadError').textContent}));
    assert(defaultBackend ? ['cpu', 'webgpu'].includes(state.backend) : state.backend === 'cpu'); assert.equal(state.phase, 'playing'); assert(!state.error);
    checks.push({realGame: true, backend: state.backend, freshResponses: state.observations.length, nonzeroNeuralOutput: true});
    await page.locator('#pauseButton').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'paused');
  }
  await screenshot(page, 'desktop');
  if (mode === 'gzip') {
    assert.equal(modelRequests.filter(r => r.path.includes('/chunks/brain-gzip-') && r.status === 200).length, 2);
    assert(!modelRequests.some(r => r.path.includes('/chunks/brain-raw-')));
  } else if (mode === 'fallback') {
    assert(modelRequests.some(r => r.path.includes('/chunks/brain-gzip-0-') && r.status === 204));
    assert.equal(modelRequests.filter(r => r.path.includes('/chunks/brain-raw-') && r.status === 200).length, 3);
  } else assert(modelRequests.some(r => r.path.includes('/model/brain.bin') && r.status === 200));
  await context.close();
  if (product === 'poker' && mode === 'gzip') for (const [width, locale, label] of [[320, 'en-US', 'Source code on GitHub'], [390, 'ja-JP', 'GitHubのソースコード'], [430, 'zh-CN', 'GitHub 源码']]) {
    const mobile = await browser.newContext({locale, viewport: {width, height: 844}}), tab = await mobile.newPage();
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto(base);
    await tab.waitForFunction(() => !!document.getElementById('rivalWindow').dataset.renderer);
    assert.equal(await tab.locator('.github-link').getAttribute('aria-label'), label);
    const layout = await tab.evaluate(() => {
      const nodes = ['.github-link', '#musicControl', '.language-picker', '#rulesButton', '.clock'].map(s => document.querySelector(s).getBoundingClientRect().toJSON());
      return {width: innerWidth, scrollWidth: document.documentElement.scrollWidth, nodes,
        observerTop: document.querySelector('.observer-rail').getBoundingClientRect().top, handBottom: document.querySelector('.hand-panel').getBoundingClientRect().bottom};
    });
    assert.equal(layout.width, layout.scrollWidth); assert(layout.observerTop >= layout.handBottom);
    for (let i = 0; i < layout.nodes.length; i++) {
      const box = layout.nodes[i]; assert(box.left >= 0 && box.right <= width);
      if (i) assert(box.left >= layout.nodes[i - 1].right);
    }
    await screenshot(tab, `mobile-${width}`); checks.push({mobileWidth: width, locale, sourceLinkAccessible: true, noToolbarOverlap: true});
    await mobile.close();
  }
  assert.deepEqual(errors, []);
  const report = {checkedAt: new Date().toISOString(), base, product, mode, forcedCpu: !defaultBackend, browser: browser.version(), checks, modelRequests, errors,
    scope: 'Real browser game and complete graph; fixed poker deal; no mock neural computation. Software 3D rendering. The fallback mode deliberately replaces the first gzip part with HTTP 204. Mobile checks use emulated viewports.'};
  await fs.writeFile(new URL(`cloudflare-${tag}-${product}-${mode}-browser.json`, output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {await browser.close();}
