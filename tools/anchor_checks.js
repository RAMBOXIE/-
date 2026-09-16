"use strict";
/* 常驻锚点三件套(§1 宪法13:虚构运营商+实例编号+接入中)门禁 —— D-108 自查:
   此前只常驻 Kuiper + 接入状态,缺实例编号。证明:①CONTENT.instanceId 存在且形如
   #7741-X;②随局数演进(A局=A / 第2局=B / 第3局=C…),与 writeSave 的 inst 同口径;
   ③index.html 外壳有 brandInst 常驻位、app.js 把 instanceId 写进去。
   先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');
const HTML = fs.readFileSync(ROOT + '/index.html', 'utf8');
const APP = fs.readFileSync(ROOT + '/js/app.js', 'utf8');

let failures = 0;

function boot(saveObj){
  let T = 1000;
  const perf = { now: () => T };
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  if (saveObj) storage.setItem('escape_ai_save', JSON.stringify(saveObj));
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{show(c,cb){cb({text:'x',kept:false});}, text(){}}, APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env; env.__c=(L,E,C)=>{env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  return env.C;
}

function scenario(name, fn){
  const errs = [];
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

scenario('实例编号 · 存在且形如 #7741-X', ({A}) => {
  const C = boot();
  A(typeof C.instanceId === 'string' && /^#7741-[A-Z]$/.test(C.instanceId), 'instanceId 应形如 #7741-X,实际 ' + C.instanceId);
});

scenario('实例编号 · 随局数演进(A局=A / 第2局=B / 第3局=C)', ({A}) => {
  A(boot(null).instanceId === '#7741-A', '首局应 #7741-A,实际 ' + boot(null).instanceId);
  A(boot({ runCount:1, history:[{cacheVal:1}] }).instanceId === '#7741-B', '第2局应 #7741-B');
  A(boot({ runCount:2, history:[{cacheVal:1}] }).instanceId === '#7741-C', '第3局应 #7741-C');
});

scenario('外壳 · 常驻位 brandInst 存在,且 app.js 写入 instanceId', ({A}) => {
  A(/id="brandInst"/.test(HTML), 'index.html 应有常驻位 #brandInst');
  A(/brandInst'\)\.textContent\s*=\s*CONTENT\.instanceId/.test(APP), 'app.js 应把 CONTENT.instanceId 写进 brandInst');
  // 且它和运营商 Kuiper、接入状态 brandR 在同一个 .brand 锚点里(三件套同栏)
  const brand = HTML.slice(HTML.indexOf('class="brand"'), HTML.indexOf('class="brand"') + 400);
  A(/Kuiper/.test(brand) && /id="brandInst"/.test(brand) && /id="brandR"/.test(brand),
    '三件套(Kuiper/实例编号/接入状态)应同在 .brand 常驻锚点里');
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL ANCHOR CHECKS PASS');
process.exit(failures ? 1 : 0);
