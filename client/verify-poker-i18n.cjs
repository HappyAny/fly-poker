const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../dist/poker-i18n.js'),'utf8');
function create(saved,browser='zh-CN',languages){
 const storage=new Map([['fly-poker-language','ja'],...(saved?[['fly-poker-locale',saved]]:[])]),context={navigator:{language:browser,languages},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};
 vm.createContext(context);vm.runInContext(source,context);return{api:context.PokerI18n,storage};
}
test('every language has all interface keys and the same interpolation fields',()=>{
 const {api}=create(),sets=Object.keys(api.locales).map(l=>Object.keys(api.locales[l]).sort());assert.deepEqual(sets[0],sets[1]);assert.deepEqual(sets[0],sets[2]);
 const fields=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
 for(const key of sets[0])for(const lang of ['en','ja']){assert(api.locales[lang][key].length>0,key);assert.deepEqual(fields(api.locales['zh-CN'][key]),fields(api.locales[lang][key]),lang+': '+key);}
 const html=fs.readFileSync(require('node:path').join(__dirname,'../dist/index.html'),'utf8');for(const m of html.matchAll(/data-i18n(?:-aria-label|-alt|-content)?="([^"]+)"/g))assert(Object.hasOwn(api.locales.en,m[1]),m[1]);
});
test('browser language is the initial default and explicit selection persists separately',()=>{
 assert.equal(create(null,'en-GB').api.language,'en');assert.equal(create(null,'zh-TW').api.language,'zh-CN');assert.equal(create(null,'ja-JP').api.language,'ja');assert.equal(create(null,'en-US').api.preference,'auto');
 assert.equal(create('ja','en-US').api.language,'ja');assert.equal(create('__proto__','en-US').api.language,'en');
 const {api,storage}=create();api.setLanguage('ja-JP');assert.equal(storage.get('fly-poker-locale'),'ja');assert.equal(create(storage.get('fly-poker-locale'),'en-US').api.language,'ja');
 api.setLanguage('auto');assert.equal(storage.get('fly-poker-locale'),'auto');assert.equal(create(storage.get('fly-poker-locale'),'en-US').api.language,'en');assert.equal(create(storage.get('fly-poker-locale'),'ja-JP').api.language,'ja');
});
test('browser preference list chooses a supported locale and unsupported browsers get English',()=>{
 assert.equal(create(null,'fr-FR',['fr-FR','ja-JP','en-US']).api.language,'ja');
 assert.equal(create(null,'fr-FR',['fr-FR']).api.language,'en');
});
test('changing language updates an existing dynamic move without changing its source data',()=>{
 const {api}=create(),element={isConnected:true},state={cards:[1,2],revision:7};
 api.text(element,'{move} · {count} 张',{move:api.ref('对子'),count:state.cards.length});assert.equal(element.textContent,'对子 · 2 张');
 api.setLanguage('en');assert.equal(element.textContent,'Pair · 2 cards');assert.equal(api.t('{move} · {count} 张',{move:api.ref('单张'),count:1}),'Single · 1 card');assert.equal(api.t('{move} · {count} 张',{move:api.ref('单张'),count:11}),'Single · 11 cards');api.setLanguage('ja');assert.equal(element.textContent,'ペア · 2枚');assert.deepEqual(state,{cards:[1,2],revision:7});
});
test('new status replaces old bindings and translated error parameters stay plain text',()=>{
 const {api}=create(),element={isConnected:true,setAttribute(k,v){this[k]=v;}};
 api.text(element,'准备果蝇…');api.text(element,'计算暂停：{error} 点继续可重试。',{error:api.ref('领出时不能过牌')});api.setLanguage('en');assert.match(element.textContent,/cannot pass when leading/);assert(!element.textContent.includes('ready'));
 api.text(element,'{suit}{rank}',{suit:api.ref('♠'),rank:'A'},'aria-label');assert.equal(element['aria-label'],'A of spades');api.setLanguage('ja');assert.equal(element['aria-label'],'スペードのA');
 api.text(element,'{error}',{error:'<img src=x onerror=1>'});assert.equal(element.textContent,'<img src=x onerror=1>');assert.equal(element.innerHTML,undefined);
});
