"use strict";
/* 反应校准屏(D-108 恢复 · canon M1 格8「遭遇结束后立即出」·验证项1/3 采集点)门禁。
   证明:①中段遭遇任一出口结束后都落到 calib(不是直接回收件箱);②两问 1-5 量表把
   {tension,control} 记进 S.calib + 遥测;③末问后解锁风险标注 riskLabels;④第一问后不
   提前结束。先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/prefs.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
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
  return { E:env.E, C:env.C, S:env.E.S, cur:()=>env.C.currentId, frame:()=>{ ft=[]; L.frame(()=>env.C.render()); return ft.join('｜'); } };
}

function scenario(name, fn){
  const errs = []; const RND = Math.random;
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  Math.random = RND;
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

/* ---- 遭遇结束(midEnc1「关闭会话」出口)→ 落到 calib,不是直接回收件箱 ---- */
scenario('遭遇结束 · midEnc1 关闭会话后落到反应校准屏', ({A}) => {
  const g = boot();
  Math.random = () => 0.5;
  g.C.go('midEnc1', true);
  g.C.key('2');                                     // 关闭会话
  A(g.cur() === 'calib', '遭遇结束应到 calib,实际 ' + g.cur());
  const t = g.frame();
  A(/反应校准/.test(t), '应渲染"反应校准",实际 ' + t.slice(0, 60));
  A(/紧张程度/.test(t), '第一问应是紧张程度');
});

/* ---- midEnc2 出口同样落到 calib ---- */
scenario('遭遇结束 · midEnc2 任一选择后落到反应校准屏', ({A}) => {
  const g = boot();
  Math.random = () => 0.5;
  g.C.go('midEnc2', true);
  g.C.key('2');                                     // 不回
  A(g.cur() === 'calib', 'midEnc2 结束也应到 calib,实际 ' + g.cur());
});

/* ---- 两问记录 + 末问解锁风险标注 ---- */
scenario('两问 1-5 · 记 {tension,control} + 末问解锁风险标注', ({A}) => {
  const g = boot();
  Math.random = () => 0.5;
  A(g.S.riskLabels !== true, 'A局遭遇前风险标注应未开(基线),实际 ' + g.S.riskLabels);
  g.C.go('midEnc1', true); g.C.key('2');            // → calib
  const c0 = g.S.calib.length;
  g.C.key('4');                                     // 第一问=紧张 4
  A(g.cur() === 'calib', '第一问后不应提前离开 calib,实际 ' + g.cur());
  A(g.S.calib.length === c0, '第一问后还不该落库(要两问都答完)');
  A(g.S.riskLabels !== true, '第一问后还不该解锁风险标注');
  g.C.key('2');                                     // 第二问=被操控 2
  A(g.S.calib.length === c0 + 1, '两问答完应落库一条,实际 ' + g.S.calib.length);
  const rec = g.S.calib[g.S.calib.length - 1];
  A(rec && rec.tension === 4 && rec.control === 2, '应记 {tension:4,control:2},实际 ' + JSON.stringify(rec));
  A(g.S.riskLabels === true, '末问后应解锁风险标注');
  A(g.cur() !== 'calib', '答完两问应离开 calib,实际 ' + g.cur());
});

/* ---- 非 1-5 键不推进(量表纪律) ---- */
scenario('量表纪律 · 非 1-5 键不推进', ({A}) => {
  const g = boot();
  Math.random = () => 0.5;
  g.C.go('midEnc1', true); g.C.key('2');
  g.C.key('Enter'); g.C.key('9'); g.C.key('0');
  A(g.cur() === 'calib', '非 1-5 键不该推进/离开,实际 ' + g.cur());
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL CALIB CHECKS PASS');
process.exit(failures ? 1 : 0);
