export const MAGIC = 0x32425946;
export const PARAMETERS = Object.freeze({dt: .1, am: Math.fround(Math.exp(-.1 / 20)), ag: Math.fround(Math.exp(-.1 / 5)),
  mixed: Math.fround((Math.exp(-.1 / 5) - Math.exp(-.1 / 20)) / (1 - 20 / 5)), warmup: 400, steps: 1200});

export function inputHash(seed, node, time) {
  let h = (seed ^ Math.imul(node + 1, 0x9e3779b9) ^ Math.imul(time + 1, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b); return (h ^ (h >>> 16)) >>> 0;
}

export function thresholds(rates) {
  if (!Array.isArray(rates) || rates.length !== 4 || rates.some(x => !Number.isFinite(x) || x < 0 || x > 1000)) throw new Error('Invalid neural stimulus');
  return rates.map(value => Math.floor(value * .1 / 1000 * 4294967296));
}

export function decodeGraph(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 64 || buffer.byteLength % 4) throw new Error('Invalid model file');
  const words = new Uint32Array(buffer), [magic, version, n, edges, rowsAt, edgesAt, groupsAt, readoutAt, readoutN, stimN, flags] = words;
  if (magic !== MAGIC || version !== 2 || !n || n > 200000 || edges > 30000000 || flags > 1 ||
      rowsAt !== 16 || edgesAt !== rowsAt + n + 1 || groupsAt !== edgesAt + edges || readoutAt !== groupsAt + n ||
      !readoutN || readoutN > n || readoutAt + readoutN !== words.length) throw new Error('Incompatible model layout');
  const rows = words.subarray(rowsAt, edgesAt), packed = words.subarray(edgesAt, groupsAt), groups = words.subarray(groupsAt, readoutAt), readout = words.subarray(readoutAt);
  if (rows[0] !== 0 || rows[n] !== edges) throw new Error('Invalid graph row offsets');
  let actualStim = 0;
  for (let i = 0; i < n; i++) {
    if (rows[i] > rows[i + 1] || groups[i] > 4) throw new Error('Invalid model node');
    if (groups[i] < 4) actualStim++;
    let post = 0;
    for (let e = rows[i]; e < rows[i + 1]; e++) {
      const encoded = packed[e], target = encoded & 0x3ffff;
      post = flags ? post + target : target;
      if (post >= n) throw new Error('Invalid model connection');
      if (flags) packed[e] = (encoded & 0xfffc0000) | post;
    }
  }
  if (actualStim !== stimN || readout.some(index => index >= n)) throw new Error('Invalid input or output nodes');
  words[10] = 0;
  return {buffer, words, n, edges, rowsAt, edgesAt, groupsAt, readoutAt, readoutN, stimN, rows, packed, groups, readout};
}

export async function loadGraph(onProgress = () => {}, signal) {
  const response = await fetch(new URL('model/manifest.json', import.meta.url), {signal});
  if (!response.ok) throw new Error('模型清单加载失败');
  const manifest = await response.json();
  if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes < 64 || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('模型清单格式不正确');
  if (manifest.downloads) {
    validateParts(manifest.downloads.raw, manifest.bytes);
    if (manifest.downloads.gzip) validateParts(manifest.downloads.gzip, manifest.gzip_bytes);
  }
  const zipped = typeof DecompressionStream === 'function' && (!manifest.downloads || !!manifest.downloads.gzip);
  let buffer;
  try {buffer = await downloadGraph(manifest, zipped, onProgress, signal);}
  catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    if (!zipped) throw new Error('脑模型下载未完成，请点「发牌」重试。');
    // Some desktop download handlers replace .gz requests with an empty 204.
    // The existing raw model is byte-identical after decompression and shares its hash.
    try {buffer = await downloadGraph(manifest, false, onProgress, signal, true);}
    catch (fallbackError) {
      if (signal?.aborted || fallbackError.name === 'AbortError') throw fallbackError;
      throw new Error('脑模型下载未完成，兼容下载也未成功。请检查连接后重试。');
    }
  }
  return {graph: decodeGraph(buffer), manifest};
}

async function downloadGraph(manifest, zipped, onProgress, signal, compatibility = false) {
  const expected = zipped ? manifest.gzip_bytes : manifest.bytes;
  onProgress({loaded: 0, total: expected, compatibility});
  const requests = new AbortController();
  const abort = () => requests.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, {once: true});
  try {
  let loaded = 0, last = 0;
  const received = count => {
    loaded += count;
    if (performance.now() - last > 100 || loaded >= expected) { onProgress({loaded, total: expected, compatibility}); last = performance.now(); }
  };
  let download, stream;
  if (manifest.downloads) {
    stream = partStream(manifest.downloads[zipped ? 'gzip' : 'raw'], requests, received);
  } else {
    const url = new URL(`model/brain.bin${zipped ? '.gz' : ''}?v=${manifest.sha256.slice(0, 16)}`, import.meta.url);
    download = await fetch(url, {signal: requests.signal, cache: 'force-cache'});
    if (download.status !== 200) throw new Error('Incomplete model response');
    stream = download.body;
  }
  if (stream && !manifest.downloads && typeof TransformStream === 'function') stream = stream.pipeThrough(new TransformStream({transform(chunk, controller) {
    received(chunk.byteLength);
    controller.enqueue(chunk);
  }}));
  let buffer;
  if (stream) {
    if (zipped) stream = stream.pipeThrough(new DecompressionStream('gzip'));
    buffer = await new Response(stream).arrayBuffer();
  } else {
    buffer = await download.arrayBuffer();
    if (zipped) buffer = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  if (buffer.byteLength !== manifest.bytes) throw new Error('模型文件长度不匹配，请重新下载。');
  await verifyDigest(buffer, manifest.sha256);
  onProgress({loaded: expected, total: expected, compatibility});
  return buffer;
  } finally {
    signal?.removeEventListener('abort', abort);
    requests.abort();
  }
}

function validateParts(parts, expected) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 16 || !Number.isSafeInteger(expected) || expected < 1) throw new Error('模型清单格式不正确');
  const names = new Set();
  let total = 0;
  for (const part of parts) {
    if (!part || !/^chunks\/[a-z0-9][a-z0-9._-]*\.bin$/.test(part.file) || names.has(part.file) ||
        !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > 25 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new Error('模型清单格式不正确');
    names.add(part.file); total += part.bytes;
  }
  if (total !== expected) throw new Error('模型清单格式不正确');
}

async function verifyDigest(buffer, expected) {
  if (!globalThis.crypto?.subtle) return;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  if ([...bytes].map(x => x.toString(16).padStart(2, '0')).join('') !== expected) throw new Error('模型校验失败，请重新下载。');
}

function partStream(parts, requests, received) {
  let index = 0, cancelled = false;
  // Verify one bounded part before passing it to the streaming decompressor.
  // The gzip stream may cross any part boundary, including its header/trailer.
  return new ReadableStream({
    async pull(controller) {
      try {
        if (requests.signal.aborted) throw requests.signal.reason;
        const part = parts[index++];
        const download = await fetch(new URL('model/' + part.file, import.meta.url), {signal: requests.signal, cache: 'force-cache'});
        if (download.status !== 200) throw new Error('Incomplete model response');
        const bytes = new Uint8Array(part.bytes);
        let offset = 0;
        if (download.body) {
          const reader = download.body.getReader();
          try {
            for (;;) {
              const {done, value} = await reader.read();
              if (done) break;
              if (offset + value.byteLength > bytes.length) throw new Error('模型文件长度不匹配，请重新下载。');
              bytes.set(value, offset); offset += value.byteLength; received(value.byteLength);
            }
          } catch (error) { await reader.cancel().catch(() => {}); throw error; }
          finally { reader.releaseLock(); }
        } else {
          const value = new Uint8Array(await download.arrayBuffer());
          if (value.length > bytes.length) throw new Error('模型文件长度不匹配，请重新下载。');
          bytes.set(value); offset = value.length; received(value.length);
        }
        if (offset !== bytes.length) throw new Error('模型文件长度不匹配，请重新下载。');
        await verifyDigest(bytes, part.sha256);
        if (requests.signal.aborted) throw requests.signal.reason;
        if (cancelled) return;
        controller.enqueue(bytes);
        if (index === parts.length) controller.close();
      } catch (error) { if (!cancelled) controller.error(error); }
    },
    cancel(reason) { cancelled = true; requests.abort(reason); }
  }, {highWaterMark: 0});
}

export function sparseResponse(output, readoutN) {
  const r = [];
  for (let i = 0; i < readoutN; i++) if (output[i]) r.push([i, output[i]]);
  return {r, active: output[readoutN] || r.length};
}
