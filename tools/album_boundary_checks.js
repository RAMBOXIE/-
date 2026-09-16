"use strict";
/* 相册深搜归档边界成本(D-108 · README_数值 §相册深翻第3次「无收益,深搜成本照扣」)门禁。
   证明:第1次+340(4格)/ 第2次+120(2格)/ 第3次(归档边界)无缓存收益但照扣深搜成本(电量-5)。
   此前第3次跳过 ENGINE.act = 送一次免费深搜。先用未修复代码验证会报警,再信它。 */
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

scenario('相册三翻 · 边界(第3次)无收益但深搜成本照扣', ({A}) => {
  const g = boot();
  g.C.go('album', true);
  const bat0 = g.S.battery, cache0 = g.S.cacheVal;
  g.C.key('1');                                   // 深翻1:+340,4格
  const c1 = g.S.cacheVal;
  A(c1 === cache0 + 340, '第1次应 +340,实际 +' + (c1 - cache0));
  g.C.key('1');                                   // 深翻2:+120,2格
  const c2 = g.S.cacheVal, bat2 = g.S.battery;
  A(c2 === c1 + 120, '第2次应 +120,实际 +' + (c2 - c1));
  g.C.key('1');                                   // 第3次:归档边界
  A(g.S.cacheVal === c2, '边界无缓存收益,实际变 ' + (g.S.cacheVal - c2));
  A(g.S.battery === bat2 - 5, '边界仍应扣深搜电量 -5(不是免费),实际扣 ' + (bat2 - g.S.battery));
  A((g.S.settle || []).join('').includes('归档边界'), '应叙及"已到归档边界"');
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL ALBUM-BOUNDARY CHECKS PASS');
process.exit(failures ? 1 : 0);
