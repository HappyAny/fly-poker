struct Params {
  n: u32, base: u32, steps: u32, warmup: u32,
  seed: u32, connected: u32, pad0: u32, pad1: u32,
  cutoff: vec4<u32>,
  am: f32, ag: f32, mixed: f32, pad2: u32,
};
struct Neuron { v: f32, g: f32, until: u32, fired: u32, count: u32, };
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> graph: array<u32>;
@group(0) @binding(2) var<storage, read_write> neurons: array<Neuron>;
@group(0) @binding(3) var<storage, read_write> arrivals: array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> output: array<atomic<u32>>;

fn input_hash(seed: u32, node: u32, time: u32) -> u32 {
  var h = seed ^ ((node + 1u) * 0x9e3779b9u) ^ ((time + 1u) * 0x85ebca6bu);
  h = h ^ (h >> 16u); h = h * 0x7feb352du; h = h ^ (h >> 15u);
  h = h * 0x846ca68bu; return h ^ (h >> 16u);
}

@compute @workgroup_size(128)
fn reset(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.n) { return; }
  neurons[id.x] = Neuron(-52.0, 0.0, 0u, 0u, 0u);
}

@compute @workgroup_size(128)
fn clear_counts(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.n) { return; }
  neurons[id.x].count = 0u;
  neurons[id.x].fired = 0u;
}

// An 18-step block cannot receive spikes generated within that block: delay = 18.
// Dispatch boundaries synchronize the whole graph; no cross-workgroup barrier is assumed.
@compute @workgroup_size(128)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i >= p.n) { return; }
  var state = neurons[i]; state.fired = 0u;
  let group = graph[graph[6] + i];
  for (var k = 0u; k < p.steps; k++) {
    let t = p.base + k;
    let q = (t % 36u) * p.n + i;
    let incoming = atomicExchange(&arrivals[q], 0);
    state.g = state.g + f32(incoming) * 0.275;
    if (t >= state.until && (state.v != -52.0 || state.g != 0.0)) {
      let leak = (state.v + 52.0) * p.am;
      let synaptic = state.g * p.mixed;
      state.v = (-52.0 + leak) + synaptic;
      state.g = state.g * p.ag;
    }
    if (group < 4u) {
      if (input_hash(p.seed, i, t) < p.cutoff[group]) { state.v = state.v + 68.75; }
    }
    if (t >= state.until && state.v > -45.0) {
      if (t >= p.warmup) { state.count++; }
      state.v = -52.0; state.g = 0.0;
      state.until = t + select(22u, 0u, group < 4u);
      state.fired = state.fired | (1u << k);
    }
  }
  neurons[i] = state;
}

@compute @workgroup_size(128)
fn propagate(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i >= p.n || p.connected == 0u) { return; }
  let events = neurons[i].fired; if (events == 0u) { return; }
  let begin = graph[graph[4] + i]; let end = graph[graph[4] + i + 1u];
  for (var edge = begin; edge < end; edge++) {
    let packed = graph[graph[5] + edge];
    let post = packed & 0x3ffffu; let weight = bitcast<i32>(packed) >> 18u;
    var bits = events;
    while (bits != 0u) {
      let k = firstTrailingBit(bits); bits = bits & (bits - 1u);
      let q = ((p.base + k + 18u) % 36u) * p.n + post;
      atomicAdd(&arrivals[q], weight);
    }
  }
}

@compute @workgroup_size(128)
fn gather(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i >= p.n) { return; }
  let readout_n = graph[8];
  if (i < readout_n) { atomicStore(&output[i], neurons[graph[graph[7] + i]].count); }
  if (neurons[i].count > 0u) { atomicAdd(&output[readout_n], 1u); }
}
