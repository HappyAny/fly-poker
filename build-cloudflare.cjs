'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const root = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(root, 'client-assets.json'), 'utf8'));
const target = path.join(root, '.cloudflare', 'public');
const limit = 20 * 1024 * 1024;
const output = new Map();
for (const file of config.files) {
  if (file.includes('..') || file.includes('\\') || file.startsWith('/') || output.has(file)) throw Error('Invalid asset path: ' + file);
  if (['model/brain.bin', 'model/brain.bin.gz', 'model/manifest.json'].includes(file)) continue;
  output.set(file, fs.readFileSync(path.join(root, 'dist', file)));
}
const model = JSON.parse(fs.readFileSync(path.join(root, 'dist/model/manifest.json'), 'utf8'));
const raw = fs.readFileSync(path.join(root, 'dist/model/brain.bin'));
const gzip = fs.readFileSync(path.join(root, 'dist/model/brain.bin.gz'));
if (raw.length !== model.bytes || digest(raw) !== model.sha256 || gzip.length !== model.gzip_bytes || digest(gzip) !== model.gzip_sha256 || !zlib.gunzipSync(gzip).equals(raw)) throw Error('Source model integrity check failed');
model.downloads = {};
for (const [encoding, bytes] of [['gzip', gzip], ['raw', raw]]) {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += limit) {
    const part = bytes.subarray(offset, Math.min(bytes.length, offset + limit));
    const sha256 = digest(part);
    const file = `chunks/brain-${encoding}-${parts.length}-${sha256.slice(0, 16)}.bin`;
    output.set('model/' + file, part);
    parts.push({file, bytes: part.length, sha256});
  }
  model.downloads[encoding] = parts;
}
output.set('model/manifest.json', Buffer.from(JSON.stringify(model, null, 2) + '\n'));
output.set('_headers', Buffer.from('/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/model/chunks/*\n  Content-Type: application/octet-stream\n  Cache-Control: public, max-age=31536000, immutable\n/model/manifest.json\n  Cache-Control: no-cache\n/*.mjs\n  Content-Type: text/javascript; charset=utf-8\n/*.wgsl\n  Content-Type: text/plain; charset=utf-8\n'));
const report = {product: config.product, modelSha256: model.sha256, maxAssetBytes: 0, files: {}};
for (const [file, bytes] of output) {
  if (bytes.length > 25 * 1024 * 1024) throw Error('Asset exceeds Cloudflare limit: ' + file);
  const destination = path.join(target, file);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, bytes);
  report.maxAssetBytes = Math.max(report.maxAssetBytes, bytes.length);
  report.files[file] = {bytes: bytes.length, sha256: digest(bytes)};
}
function checkDirectory(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Unexpected symlink in deployment');
    if (entry.isDirectory()) checkDirectory(absolute);
    else if (!output.has(path.relative(target, absolute).replaceAll('\\', '/'))) throw Error('Unexpected file in deployment: ' + entry.name);
  }
}
checkDirectory(target);
fs.mkdirSync(path.join(root, 'release'), {recursive: true});
fs.writeFileSync(path.join(root, 'release/cloudflare-build.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`${config.product}: ${output.size} public assets; largest ${(report.maxAssetBytes / 1024 / 1024).toFixed(2)} MiB; complete original model verified`);
