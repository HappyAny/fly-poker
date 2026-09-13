import {loadGraph} from './brain-graph.mjs';
import {CpuBrain} from './brain-cpu.mjs';
import {GpuBrain} from './brain-gpu.mjs';
import './poker-core.js';
import './poker-search.js';
import './poker-strategy.js';

let brain, readout, epoch = 0, chain = Promise.resolve();
const channel = new MessageChannel(), yields = [];
channel.port1.onmessage = () => yields.shift()?.();
const yieldTask = () => new Promise(resolve => {yields.push(resolve); channel.port2.postMessage(0);});
const status = value => postMessage({type: 'status', ...value});
const graph = () => loadGraph(progress => status({phase: 'download', ...progress}));
async function initialize() {
  if (brain && readout) return {backend: brain.backend};
  const [loaded, response] = await Promise.all([graph(), fetch(new URL('data/poker-policy.json', import.meta.url))]);
  if (!response.ok) throw new Error('出牌策略加载失败');
  readout = new FlyPokerStrategy.Readout(await response.json()); status({phase: 'initializing'});
  try {brain = await GpuBrain.create(loaded.graph); await brain.runFrame([12,12,12,12], 0, {steps: readout.model.steps, reset: true});}
  catch {brain?.destroy(); brain = await CpuBrain.create(loaded.graph);}
  status({phase: 'ready', backend: brain.backend}); return {backend: brain.backend};
}
async function choose(message) {
  if (!brain || !readout) throw new Error('模型尚未就绪');
  const options = {yieldTask, cancelled: () => message.epoch !== epoch,
    progress: value => {if (message.epoch === epoch) status({phase: 'thinking', epoch: message.epoch, requestId: message.id, revision: message.view.revision, ...value});},
    observation: value => {if (message.epoch === epoch) status({phase: 'neural', epoch: message.epoch, requestId: message.id, revision: message.view.revision, ...value});}};
  status({phase: 'planning', epoch: message.epoch, requestId: message.id, revision: message.view.revision});
  try {return await FlyPokerStrategy.choose(message.view, message.profile, brain, readout, options);}
  catch (error) {
    if (message.epoch !== epoch || brain.backend === 'cpu') throw error;
    status({phase: 'fallback', backend: 'cpu'}); brain.destroy(); brain = null;
    const loaded = await graph(); brain = await CpuBrain.create(loaded.graph);
    status({phase: 'ready', backend: 'cpu'});
    return FlyPokerStrategy.choose(message.view, message.profile, brain, readout, options);
  }
}
onmessage = event => {
  const message = event.data;
  if (message.type === 'cancel') {epoch = message.epoch; return;}
  if (!['init', 'choose'].includes(message.type)) return;
  chain = chain.then(async () => {
    try {const value = message.type === 'init' ? await initialize() : await choose(message); postMessage({id: message.id, value});}
    catch (error) {postMessage({id: message.id, error: error.message || '本机仿真失败'});}
  });
};
