"use strict";
/* 账本永真(宪法14①)门禁 —— 对照 D-108 自查发现:A局死亡回收单曾打印
   "可解析度: 首次建档"/"世界回声: 已计入 Stage 1" 两个无背书数值。
   M1 v0.4 文档头自己把这两个数值列为"无背书,v0.4 删去"(可解析度主刻度纸面无从
   计算;Stage 是全服级世界层状态,单机教学局没有任何系统在维护它)。
   证明:A 局死亡回收单不再印这两个编造出来的字段。
   先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;

function boot(){
  let T = 1000;
  const perf = { now: () => T };
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{show(c,cb){cb({text:'x',kept:false});}, text(){}}, APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env; env.__c=(L,E,C)=>{env.L=L;env.E=E;env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  const L = env.L; let ft = [];
  for (const fn of ['drawText','drawPara']){ const o = L[fn]; L[fn] = function(x,y,s,...r){ if (typeof s==='string') ft.push(s); return o.call(this,x,y,s,...r); }; }
  return { E:env.E, C:env.C, S:env.E.S, frame:()=>{ ft=[]; L.frame(()=>env.C.render()); return ft.join('｜'); } };
}

function scenario(name, fn){
  const errs = [];
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

scenario('A局死亡回收单 · 不印无背书的"可解析度"/"Stage"', ({A}) => {
  const g = boot();
  g.C.go('report', true);
  g.C.key('Enter');                 // 翻到 page 1(案卷具名页,曾经印这两个字段的地方)
  const t = g.frame();
  A(!t.includes('可解析度'), '不该出现编造的"可解析度"字段,实际 ' + t.slice(0, 200));
  A(!/Stage\s*1/.test(t), '不该出现编造的"Stage 1"字段,实际 ' + t.slice(0, 200));
  A(t.includes('样本评级'), '样本评级(真实存在的字段)应该还在,回归检查未误删');
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL LEDGER-TRUTH CHECKS PASS');
process.exit(failures ? 1 : 0);
