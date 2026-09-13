import {PARAMETERS, thresholds, sparseResponse} from './brain-graph.mjs';

export class CpuBrain {
  static async create(graph, wasmBytes) {
    const bytes = wasmBytes || await (await fetch(new URL('brain-cpu.wasm', import.meta.url))).arrayBuffer();
    const {instance} = await WebAssembly.instantiate(bytes, {});
    const api = instance.exports, pointer = api.allocate(graph.words.length);
    new Uint32Array(api.memory.buffer, pointer, graph.words.length).set(graph.words);
    if (api.initialize(pointer, graph.words.length) !== 1) throw new Error('CPU 仿真初始化失败');
    return new CpuBrain(api, graph.n, graph.readoutN);
  }
  constructor(api, nodes, readoutN) { this.api = api; this.n = nodes; this.readoutN = readoutN; this.backend = 'cpu'; }
  run(rates, seed, options = {}) {
    this.streamReady = false;
    const cuts = thresholds(rates), steps = options.steps ?? PARAMETERS.steps, warmup = options.warmup ?? PARAMETERS.warmup;
    if (!Number.isInteger(steps) || steps < 1 || steps > 10000 || !Number.isInteger(warmup) || warmup < 0 || warmup > steps) throw new Error('Invalid simulation window');
    const start = performance.now(); this.api.begin(seed >>> 0, ...cuts, warmup, options.connected === false ? 0 : 1);
    this.api.step(steps);
    return this.result(seed, performance.now() - start);
  }
  async runAsync(rates, seed, {yieldTask, cancelled = () => false} = {}) {
    this.streamReady = false;
    const cuts = thresholds(rates), start = performance.now();
    this.api.begin(seed >>> 0, ...cuts, PARAMETERS.warmup, 1);
    for (let done = 0; done < PARAMETERS.steps; done += 144) {
      if (cancelled()) throw new Error('Simulation cancelled');
      this.api.step(Math.min(144, PARAMETERS.steps - done));
      if (yieldTask) await yieldTask();
    }
    return this.result(seed, performance.now() - start);
  }
  runFrame(rates, seed, {steps = 180, reset = false, connected = true} = {}) {
    const cuts = thresholds(rates);
    if (!Number.isInteger(steps) || steps < 1 || steps > 1000) throw new Error('Invalid observation window');
    const start = performance.now();
    if (reset || !this.streamReady || this.streamSeed !== (seed >>> 0)) {
      this.api.begin(seed >>> 0, ...cuts, 0, connected ? 1 : 0); this.streamTime = 0;
    } else this.api.frame(...cuts, connected ? 1 : 0);
    this.api.step(steps); this.streamTime += steps; this.streamSeed = seed >>> 0; this.streamReady = true;
    return {...this.result(seed, performance.now() - start), modelSteps: steps, modelTime: this.streamTime};
  }
  result(seed, elapsedMs) {
    const pointer = this.api.finish(), output = new Uint32Array(this.api.memory.buffer, pointer, this.readoutN + 4).slice();
    return {...sparseResponse(output, this.readoutN), counts: output.subarray(0, this.readoutN), elapsedMs, backend: 'cpu',
      stats: {nodeVisits: output[this.readoutN + 1], peakActive: output[this.readoutN + 2], spikes: output[this.readoutN + 3],
        wasmBytes: this.api.memory.buffer.byteLength}, seed: seed >>> 0};
  }
  debugState() { return {v: new Float32Array(this.api.memory.buffer, this.api.states(), this.n).slice(),
    g: new Float32Array(this.api.memory.buffer, this.api.synaptic_states(), this.n).slice(),
    counts: new Uint32Array(this.api.memory.buffer, this.api.all_counts(), this.n).slice()}; }
  destroy() { this.api = null; }
}
