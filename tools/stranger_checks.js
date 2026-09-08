"use strict";
/* 误触号码的陌生人(D-104,离线)门禁 —— 对照决策日志 D-104。
   证明:每局一个陌生号码;读信免费;真人=真线索(不掉资源)/ 饵=踩饵(掉缓存+涨溯源);
   真/饵两种都能播到;陌生短信不泄窗口时刻。先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;

function boot(){   // 调用前可先固定 Math.random 以决定陌生人真/饵种子
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
  const errs = []; const RND = Math.random;
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  Math.random = RND;
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}
// 固定种子启动(kind: real=<0.5, bait=>=0.5)
function bootKind(kind){ Math.random = () => (kind === 'real' ? 0.1 : 0.9); const g = boot(); Math.random = Math.random; return g; }

/* ---- 每局都有陌生号码,且未读带 (1),读后清 ---- */
scenario('每局有陌生号码 · 未读(1)读后清', ({A}) => {
  const g = bootKind('real');
  g.C.go('inbox', true);
  let t = g.frame();
  A(t.includes('陌生号码'), '收件箱应有一条「陌生号码」');
  A(/陌生号码[^｜]*\(1\)|\(1\)[^｜]*陌生/.test(t) || g.S.stranger.read === false, '陌生号码初始应未读');
  g.C.go('th_stranger', true); g.frame();
  A(g.S.stranger.read === true, '打开后应标记已读');
});

/* ---- 读信免费:进 th_stranger 不扣电量/不涨溯源 ---- */
scenario('读信免费 · 打开不扣电量不涨溯源', ({A}) => {
  const g = bootKind('real');
  const b0 = g.S.battery, t0 = g.S.trace;
  g.C.go('th_stranger', true); g.frame();
  A(g.S.battery === b0, '读信不扣电量,实际扣 ' + (b0 - g.S.battery));
  A(g.S.trace === t0, '读信不涨溯源,实际 +' + (g.S.trace - t0));
});

/* ---- 真人:顺着查=真线索,涨溯源(+2)但不掉缓存 ---- */
scenario('真人 · 顺着查给线索、不掉缓存', ({A}) => {
  const g = bootKind('real');
  A(g.S.stranger.kind === 'real', '种子应为 real');
  g.C.go('th_stranger', true); g.frame();
  const c0 = g.S.cacheVal, t0 = g.S.trace;
  g.C.key('1');                                   // 顺着查
  A(g.S.cacheVal === c0, '真人线索不掉缓存,实际变 ' + (g.S.cacheVal - c0));
  A(g.S.trace === t0 + 2, '真人顺着查溯源 +2,实际 +' + (g.S.trace - t0));
  A(!!g.S.clues.strangerReal, '应标记 strangerReal 线索');
  A((g.S.settle || []).join('').includes('相册'), '真线索应指向相册,实际 ' + JSON.stringify(g.S.settle));
});

/* ---- 饵:顺着查=踩饵,掉缓存(−15%)且溯源 +6 ---- */
scenario('饵 · 顺着查踩饵掉缓存+涨溯源', ({A}) => {
  const g = bootKind('bait');
  A(g.S.stranger.kind === 'bait', '种子应为 bait');
  g.S.cacheVal = 1000;
  g.C.go('th_stranger', true); g.frame();
  const t0 = g.S.trace;
  g.C.key('1');
  A(g.S.cacheVal === 850, '踩饵缓存应 −15%(1000→850),实际 ' + g.S.cacheVal);
  A(g.S.trace === t0 + 6, '踩饵溯源 +6,实际 +' + (g.S.trace - t0));
  A(!!g.S.clues.strangerBait, '应标记 strangerBait');
});

/* ---- 真/饵两种都能被种子播到(不是常量) ---- */
scenario('种子 · 真与饵都能播到', ({A}) => {
  A(bootKind('real').S.stranger.kind === 'real', 'real 种子应得 real');
  A(bootKind('bait').S.stranger.kind === 'bait', 'bait 种子应得 bait');
});

/* ---- 秘匿:陌生短信正文不泄窗口时刻 ---- */
scenario('秘匿 · 陌生短信不含窗口时刻', ({A}) => {
  ['real','bait'].forEach(kind => {
    const g = bootKind(kind);
    g.C.go('th_stranger', true);
    const t = g.frame();
    ['03:00','03:14','03:31','03:45','d100'].forEach(w => A(!t.includes(w), kind+' 陌生短信不得含窗口串「'+w+'」'));
  });
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL STRANGER CHECKS PASS');
process.exit(failures ? 1 : 0);
