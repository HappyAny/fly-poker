import {PARAMETERS, thresholds, sparseResponse} from './brain-graph.mjs';

export class GpuBrain {
  static async create(graph, gpu = globalThis.navigator?.gpu, shaderSource, onStage = () => {}) {
    if (!gpu) throw new Error('此环境未提供 WebGPU');
    onStage('adapter');
    const adapter = await gpu.requestAdapter({powerPreference: 'low-power'});
    if (!adapter) throw new Error('没有可用的 WebGPU 设备');
    const graphBytes = graph.buffer.byteLength, queueBytes = graph.n * 36 * 4;
    if (adapter.limits.maxStorageBufferBindingSize < Math.max(graphBytes, queueBytes) || adapter.limits.maxBufferSize < graphBytes) throw new Error('GPU 可用缓冲区不足，使用 CPU');
    onStage('device');
    const device = await adapter.requestDevice();
    try {
      const source = shaderSource || await (await fetch(new URL('brain.wgsl', import.meta.url))).text();
      onStage('shader');
      const module = device.createShaderModule({code: source, label: 'Full fly connectome LIF'});
      onStage('shader-info');
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error(errors.map(e => `${e.lineNum}: ${e.message}`).join('; '));
      const brain = new GpuBrain(device, graph.n, graph.readoutN);
      await brain.initialize(graph, module, onStage); return brain;
    } catch (error) { device.destroy(); throw error; }
  }
  constructor(device, n, readoutN) {
    this.device = device; this.n = n; this.readoutN = readoutN; this.backend = 'webgpu'; this.buffers = []; this.lost = null; this.busy = false;
    device.lost.then(info => { this.lost = info.message || 'WebGPU 设备已断开'; });
  }
  buffer(size, usage, label) { const buffer = this.device.createBuffer({size: Math.ceil(size / 4) * 4, usage, label}); this.buffers.push(buffer); return buffer; }
  async initialize(graph, module, onStage) {
    const d = this.device;
    onStage('buffers');
    this.graph = d.createBuffer({size: graph.buffer.byteLength, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true, label: 'Packed complete graph'});
    this.buffers.push(this.graph);
    onStage('upload');
    new Uint32Array(this.graph.getMappedRange()).set(graph.words);
    this.graph.unmap();
    onStage('states');
    this.states = this.buffer(this.n * 20, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'Neuron states');
    this.arrivals = this.buffer(this.n * 36 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'Integer delayed arrivals');
    this.outputBytes = (this.readoutN + 1) * 4;
    this.output = this.buffer(this.outputBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, 'Neural output');
    this.readback = this.buffer(this.outputBytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, 'Output staging');
    this.uniform = this.buffer(Math.ceil(10000 / 18) * 256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'Step parameters');
    onStage('layout');
    const entries = [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform', hasDynamicOffset: true, minBindingSize: 64}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      ...[2, 3, 4].map(binding => ({binding, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}})),
    ];
    const layout = d.createBindGroupLayout({entries}), pipelineLayout = d.createPipelineLayout({bindGroupLayouts: [layout]});
    this.pipelines = {};
    for (const entryPoint of ['reset', 'clear_counts', 'integrate', 'propagate', 'gather']) {
      onStage(`pipeline-${entryPoint}`);
      this.pipelines[entryPoint] = await d.createComputePipelineAsync({layout: pipelineLayout, compute: {module, entryPoint}});
    }
    this.bind = d.createBindGroup({layout, entries: [this.uniform, this.graph, this.states, this.arrivals, this.output].map((buffer, binding) => ({binding, resource: binding === 0 ? {buffer, size: 64} : {buffer}}))});
    this.allocatedBytes = this.buffers.reduce((sum, buffer) => sum + buffer.size, 0);
  }
  async run(rates, seed, options = {}) {
    this.streamReady = false;
    return this.execute(rates, seed, options);
  }
  async runFrame(rates, seed, {steps = 180, reset = false, connected = true} = {}) {
    if (!Number.isInteger(steps) || steps < 1 || steps > 1000) throw new Error('Invalid observation window');
    const restarting = reset || !this.streamReady || this.streamSeed !== (seed >>> 0);
    const offset = restarting ? 0 : this.streamTime;
    const result = await this.execute(rates, seed, {steps, warmup: 0, offset, preserve: !restarting, connected});
    this.streamTime = offset + steps; this.streamSeed = seed >>> 0; this.streamReady = true;
    return {...result, modelSteps: steps, modelTime: this.streamTime};
  }
  async execute(rates, seed, options = {}) {
    if (this.lost) throw new Error(this.lost);
    if (this.busy) throw new Error('Only one simulation may use this device state at a time');
    const cuts = thresholds(rates), steps = options.steps ?? PARAMETERS.steps, warmup = options.warmup ?? PARAMETERS.warmup;
    if (!Number.isInteger(steps) || steps < 1 || steps > 10000 || !Number.isInteger(warmup) || warmup < 0 || warmup > steps) throw new Error('Invalid simulation window');
    this.busy = true; const start = performance.now(), blocks = Math.ceil(steps / 18), params = new ArrayBuffer(blocks * 256);
    const words = new Uint32Array(params), floats = new Float32Array(params);
    for (let block = 0; block < blocks; block++) {
      const base = block * 64, offset = block * 18;
      words.set([this.n, (options.offset || 0) + offset, Math.min(18, steps - offset), warmup, seed >>> 0, options.connected === false ? 0 : 1, 0, 0, ...cuts], base);
      floats.set([PARAMETERS.am, PARAMETERS.ag, PARAMETERS.mixed], base + 12);
    }
    const d = this.device; let scopeOpen = false;
    try {
      d.pushErrorScope('validation'); scopeOpen = true; d.queue.writeBuffer(this.uniform, 0, params);
      const encoder = d.createCommandEncoder(); if (!options.preserve) encoder.clearBuffer(this.arrivals); encoder.clearBuffer(this.output);
      const pass = encoder.beginComputePass(); const workgroups = Math.ceil(this.n / 128);
      pass.setBindGroup(0, this.bind, [0]); pass.setPipeline(options.preserve ? this.pipelines.clear_counts : this.pipelines.reset); pass.dispatchWorkgroups(workgroups);
      for (let block = 0; block < blocks; block++) {
        pass.setBindGroup(0, this.bind, [block * 256]);
        pass.setPipeline(this.pipelines.integrate); pass.dispatchWorkgroups(workgroups);
        pass.setPipeline(this.pipelines.propagate); pass.dispatchWorkgroups(workgroups);
      }
      pass.setPipeline(this.pipelines.gather); pass.dispatchWorkgroups(workgroups); pass.end();
      encoder.copyBufferToBuffer(this.output, 0, this.readback, 0, this.outputBytes); d.queue.submit([encoder.finish()]);
      await this.readback.mapAsync(GPUMapMode.READ);
      const values = new Uint32Array(this.readback.getMappedRange()).slice(); this.readback.unmap();
      const error = await d.popErrorScope(); scopeOpen = false; if (error) throw new Error(error.message);
      if (this.lost) throw new Error(this.lost);
      return {...sparseResponse(values, this.readoutN), counts: values.subarray(0, this.readoutN), elapsedMs: performance.now() - start,
        backend: 'webgpu', seed: seed >>> 0, stats: {gpuBytes: this.allocatedBytes, dispatches: blocks * 2 + 2}};
    } finally { if (scopeOpen) await d.popErrorScope().catch(() => {}); this.busy = false; }
  }
  async debugState() {
    const staging = this.buffer(this.n * 20, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, 'Test-only full states');
    const encoder = this.device.createCommandEncoder(); encoder.copyBufferToBuffer(this.states, 0, staging, 0, this.n * 20);
    this.device.queue.submit([encoder.finish()]); await staging.mapAsync(GPUMapMode.READ);
    const raw = staging.getMappedRange().slice(0); staging.unmap(); staging.destroy();
    const floats = new Float32Array(raw), words = new Uint32Array(raw), v = new Float32Array(this.n), g = new Float32Array(this.n), counts = new Uint32Array(this.n);
    for (let i = 0; i < this.n; i++) {v[i] = floats[i * 5]; g[i] = floats[i * 5 + 1]; counts[i] = words[i * 5 + 4];}
    return {v, g, counts};
  }
  destroy() { for (const buffer of this.buffers) buffer.destroy(); this.device.destroy(); }
}
