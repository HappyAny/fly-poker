import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash,webcrypto} from 'node:crypto';
import {loadGraph,MAGIC} from '../dist/brain-graph.mjs';

// Small valid graph, independent of the production model, exercises real decoding.
const words=new Uint32Array(21);
words.set([MAGIC,2,1,1,16,18,19,20,1,1,0]);
words.set([0,1,1<<18,0,0],16);
const raw=Buffer.from(words.buffer),zip=gzipSync(raw);
const manifest={bytes:raw.length,gzip_bytes:zip.length,sha256:createHash('sha256').update(raw).digest('hex')};
async function withFetch(replies,fn){
 const saved=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{const path=new URL(url).pathname.split('/').pop();calls.push({path,cache:options?.cache});return replies(path,options);};
 try{return await fn(calls);}finally{globalThis.fetch=saved;}
}
const response=path=>path==='manifest.json'?Response.json(manifest):new Response(path.endsWith('.gz')?zip:raw);
test('valid compressed download decodes once without requesting raw bytes',async()=>{
 await withFetch(response,async calls=>{const result=await loadGraph();assert.equal(result.graph.n,1);assert.equal(result.graph.edges,1);assert.deepEqual(calls.map(c=>c.path),['manifest.json','brain.bin.gz']);});
});
for(const failure of ['204','network','truncated','corrupt'])test('compressed '+failure+' falls back to the complete raw graph',async()=>{
 const progress=[];
 await withFetch(path=>{if(!path.endsWith('.gz'))return response(path);if(failure==='204')return new Response(null,{status:204});if(failure==='network')throw new TypeError('Failed to fetch');if(failure==='truncated')return new Response(zip.subarray(0,12));return new Response(gzipSync(Buffer.alloc(raw.length)));},async calls=>{
  const result=await loadGraph(s=>progress.push(s));assert.equal(result.graph.n,1);assert.equal(result.graph.edges,1);assert.deepEqual(calls.map(c=>c.path),['manifest.json','brain.bin.gz','brain.bin']);assert(progress.some(s=>s.compatibility&&s.total===raw.length));assert.equal(progress.at(-1).loaded,raw.length);
 });
});
test('failed compatibility download returns an actionable error and stops',async()=>{
 await withFetch(path=>path==='manifest.json'?response(path):new Response(null,{status:204}),async calls=>{await assert.rejects(loadGraph(),/兼容下载也未成功/);assert.equal(calls.length,3);});
});
test('cancellation does not start a compatibility download',async()=>{
 const controller=new AbortController();await withFetch(path=>{if(path==='manifest.json')return response(path);controller.abort();throw controller.signal.reason;},async calls=>{await assert.rejects(loadGraph(()=>{},controller.signal),e=>e.name==='AbortError');assert.equal(calls.length,2);});
});
test('raw mode works without DecompressionStream and retains progress',async()=>{
 const saved=globalThis.DecompressionStream;globalThis.DecompressionStream=undefined;
 try{await withFetch(response,async calls=>{assert.equal((await loadGraph()).graph.n,1);assert.deepEqual(calls.map(c=>c.path),['manifest.json','brain.bin']);});}finally{globalThis.DecompressionStream=saved;}
});
test('compatibility bytes still require the model digest in a secure context',async()=>{
 assert(globalThis.crypto?.subtle||webcrypto.subtle);
 await withFetch(path=>path==='manifest.json'?response(path):path.endsWith('.gz')?new Response(null,{status:204}):new Response(Buffer.alloc(raw.length)),async()=>{await assert.rejects(loadGraph(),/兼容下载也未成功/);});
});

function chunkFixture() {
 const files = new Map(), downloads = {};
 for (const [encoding, bytes] of [['gzip', zip], ['raw', raw]]) {
  downloads[encoding] = [];
  // Seven-byte boundaries split both the gzip header and encoded graph fields.
  for (let offset = 0; offset < bytes.length; offset += 7) {
   const part = bytes.subarray(offset, offset + 7), file = `chunks/${encoding}-${offset}.bin`;
   files.set(file.split('/').pop(), part);
   downloads[encoding].push({file, bytes: part.length, sha256: createHash('sha256').update(part).digest('hex')});
  }
 }
 const chunked = {...manifest, downloads};
 return {chunked, files, reply: path => path === 'manifest.json' ? Response.json(chunked) : files.has(path) ? new Response(files.get(path)) : new Response(null, {status: 404})};
}

test('split gzip reconstructs the original graph with verified parts and progress', async () => {
 const fixture = chunkFixture(), progress = [];
 await withFetch(fixture.reply, async calls => {
  const result = await loadGraph(value => progress.push(value));
  assert.equal(result.graph.n, 1); assert.equal(result.graph.edges, 1);
  assert.deepEqual(calls.map(c => c.path), ['manifest.json', ...fixture.chunked.downloads.gzip.map(p => p.file.split('/').pop())]);
  assert(calls.slice(1).every(c => c.cache === 'force-cache'));
  assert.equal(progress.at(-1).loaded, zip.length);
 });
});

for (const failure of ['missing', 'truncated', 'oversized', 'digest']) test(`bad gzip part (${failure}) falls back to complete raw parts`, async () => {
 const fixture = chunkFixture(), broken = fixture.chunked.downloads.gzip[1].file.split('/').pop(), progress = [];
 await withFetch(path => {
  if (path !== broken) return fixture.reply(path);
  const bytes = fixture.files.get(path);
  if (failure === 'missing') return new Response(null, {status: 404});
  if (failure === 'truncated') return new Response(bytes.subarray(0, bytes.length - 1));
  if (failure === 'oversized') return new Response(Buffer.concat([bytes, Buffer.from([0])]));
  return new Response(Buffer.alloc(bytes.length));
 }, async calls => {
  assert.equal((await loadGraph(p => progress.push(p))).graph.n, 1);
  assert(calls.some(c => c.path.startsWith('raw-')));
  assert(progress.some(p => p.compatibility));
  assert.equal(progress.at(-1).loaded, raw.length);
 });
});

test('raw parts work without gzip decompression support', async () => {
 const fixture = chunkFixture(), saved = globalThis.DecompressionStream;
 globalThis.DecompressionStream = undefined;
 try { await withFetch(fixture.reply, async calls => {
  assert.equal((await loadGraph()).graph.n, 1);
  assert(calls.slice(1).every(c => c.path.startsWith('raw-')));
 }); } finally { globalThis.DecompressionStream = saved; }
});

test('part cancellation stops the request and never enters compatibility mode', async () => {
 const fixture = chunkFixture(), controller = new AbortController();
 await withFetch(path => {
  if (path.startsWith('gzip-')) { controller.abort(); throw controller.signal.reason; }
  return fixture.reply(path);
 }, async calls => {
  await assert.rejects(loadGraph(() => {}, controller.signal), error => error.name === 'AbortError');
  assert.equal(calls.length, 2);
 });
});

for (const malformed of ['path', 'duplicate', 'size', 'total', 'hash']) test(`invalid part manifest (${malformed}) is rejected before download`, async () => {
 const fixture = chunkFixture(), parts = fixture.chunked.downloads.raw;
 if (malformed === 'path') parts[0].file = '../private.json';
 if (malformed === 'duplicate') parts[1].file = parts[0].file;
 if (malformed === 'size') parts[0].bytes = 26 * 1024 * 1024;
 if (malformed === 'total') parts[0].bytes++;
 if (malformed === 'hash') parts[0].sha256 = 'bad';
 await withFetch(fixture.reply, async calls => {
  await assert.rejects(loadGraph(), /模型清单格式不正确/);
  assert.equal(calls.length, 1);
 });
});

test('valid individual parts cannot bypass the final whole-model hash', async () => {
 const fixture = chunkFixture(); fixture.chunked.sha256 = '0'.repeat(64);
 await withFetch(fixture.reply, async () => { await assert.rejects(loadGraph(), /兼容下载也未成功/); });
});
