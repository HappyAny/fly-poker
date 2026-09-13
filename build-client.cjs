'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'client-assets.json'),'utf8'));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.wgsl':'text/plain; charset=utf-8','.gz':'application/gzip','.bin':'application/octet-stream','.png':'image/png','.txt':'text/plain; charset=utf-8','.mp3':'audio/mpeg'};
const manifest={format:config.format,product:config.product,createdAt:new Date().toISOString(),files:{}};
for(const name of config.files){
 if(name.includes('..')||name.startsWith('/')||name.includes('\\')||Object.hasOwn(manifest.files,name))throw Error('Invalid asset: '+name);
 const bytes=fs.readFileSync(path.join(__dirname,'dist',name));
 if(!types[path.extname(name)])throw Error('Unknown asset type: '+name);
 manifest.files[name]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),type:types[path.extname(name)]};
}
fs.writeFileSync(path.join(__dirname,'release/client-build.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`${config.product}: ${config.files.length} independent assets`);
