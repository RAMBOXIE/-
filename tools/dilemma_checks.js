"use strict";
/* 两难探针(D-106)门禁 —— 对照决策日志 D-106。
   证明:两难挂在骨架固定位(visited>=4 触发)+ 两条两难各分支由引擎回填数值。
   秘匿:两难叙述里不泄窗口/概率。先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const FILES = ['js/lcd.js','js/save.js','js/companion.js','js/engine.js','js/content.js'];
const SRC = FILES.map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');
const CONTENT_SRC = fs.readFileSync(ROOT + '/js/content.js', 'utf8');

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
  // 抓取渲染文案
  const L = env.L; let ft = [];
  for (const fn of ['drawText','drawPara']){ const o = L[fn]; L[fn] = function(x,y,s,...r){ if (typeof s==='string') ft.push(s); return o.call(this,x,y,s,...r); }; }
  return { E:env.E, C:env.C, S:env.E.S, frame:()=>{ ft=[]; L.frame(()=>env.C.render()); return ft.join('｜'); } };
}

function scenario(name, fn){
  const errs = []; const RND = Math.random;
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); }, rnd:v=>{ Math.random=()=>v; } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  Math.random = RND;
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

/* ---- 骨架固定位:探索深度到 4,调度即挂 dilemma 中断 ---- */
scenario('骨架位 · visited>=4 触发两难中断', ({A}) => {
  // 源码层锚点:调度钩子必须在 A 局、visited>=4、且在 midEnc(>=6)之前
  const iDil = CONTENT_SRC.indexOf("beats.dilemma && visited >= 4");
  const iMid = CONTENT_SRC.indexOf("beats.midEnc && visited >= 6");
  A(iDil > 0, '调度里必须有 visited>=4 的两难钩子');
  A(iMid > 0 && iDil < iMid, '两难必须排在 midEnc(>=6)之前');
  // afterAction 必须消费 'dilemma' → push('dilemma')
  A(/t === 'dilemma'[\s\S]{0,40}push\('dilemma'\)/.test(CONTENT_SRC), "afterAction 必须消费 dilemma 中断并 push('dilemma')");
  // beats 初值含 dilemma
  A(/beats:\s*\{[^}]*dilemma:false/.test(SRC), 'engine 节拍初值应含 dilemma:false');
});

/* ---- 两难 A(替妈撒谎):替回 → 溯源被引擎 +3;不回 → 不涨溯源 ---- */
scenario('两难·替妈撒谎 · 替回涨溯源(引擎回填)', ({A, rnd}) => {
  const g = boot();
  rnd(0);                            // POOL[0] = mom_reply
  g.C.go('dilemma', true);
  const tr0 = g.S.trace, bat0 = g.S.battery;
  g.C.key('1');                      // 替他回「到了」
  A(g.S.trace === tr0 + 3, '替妈撒谎溯源应 +3,实际 +' + (g.S.trace - tr0));
  A(g.S.battery === bat0 - 1, '动作电量应 −1');
  A((g.S.settle || []).join('').includes('谎言'), '结算应叙及"谎言又续了一分",实际 ' + JSON.stringify(g.S.settle));
});

scenario('两难·替妈撒谎 · 不回不涨溯源', ({A, rnd}) => {
  const g = boot();
  rnd(0);
  g.C.go('dilemma', true);
  const tr0 = g.S.trace;
  g.C.key('2');                      // 不回
  A(g.S.trace === tr0, '不回不应涨溯源,实际 +' + (g.S.trace - tr0));
});

/* ---- 两难 B(抢窗口):现在取 → 缓存 +120 且溯源 +3;等 → 只 +60 ---- */
scenario('两难·抢窗口 · 现在取(高值+顶信号) vs 等(打折)', ({A, rnd}) => {
  const now = boot();
  rnd(0.6);                          // POOL[1] = window_greed
  now.C.go('dilemma', true);
  const c0 = now.S.cacheVal, t0 = now.S.trace;
  now.C.key('1');
  A(now.S.cacheVal === c0 + 120, '抢窗口缓存应 +120,实际 +' + (now.S.cacheVal - c0));
  A(now.S.trace === t0 + 3, '抢窗口信号应被顶(溯源 +3),实际 +' + (now.S.trace - t0));

  const wait = boot();
  Math.random = () => 0.6;
  wait.C.go('dilemma', true);
  const c1 = wait.S.cacheVal, t1 = wait.S.trace;
  wait.C.key('2');
  A(wait.S.cacheVal === c1 + 60, '等窗口只得半价 +60,实际 +' + (wait.S.cacheVal - c1));
  A(wait.S.trace === t1, '等窗口不顶信号');
});

/* ---- 秘匿:两难屏不泄窗口时刻/概率 ---- */
scenario('秘匿 · 两难屏不含窗口时刻/概率串', ({A, rnd}) => {
  ['0','0.6'].forEach(v => {
    const g = boot();
    Math.random = () => +v;
    g.C.go('dilemma', true);
    const t = g.frame();
    // 电量「%」是玩家可见读数,非秘匿;这里只查窗口时刻与判定内部量
    ['03:00','03:14','03:31','03:45','d100','溯源','概率'].forEach(w => A(!t.includes(w), '两难屏不得含秘匿串「'+w+'」(pool '+v+')'));
  });
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL DILEMMA CHECKS PASS');
process.exit(failures ? 1 : 0);
